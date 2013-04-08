// ==UserScript==
// @name        Generic Collector
// @namespace   http://github.com/pchampin/ktbs4js/
// @description I collect trace from every website, and send them to a kTBS server (http://liris.cnrs.fr/sbt-dev/ktbs)
// @include     http://*
// @exclude     http://localhost*
// @version     1
// @grant       none
// @downloadURL https://raw.github.com/pchampin/ktbs4js/master/static/src/generic_collector.user.js
// @updateURL   https://raw.github.com/pchampin/ktbs4js/master/static/src/generic_collector.user.js
// @require     https://raw.github.com/pchampin/ktbs4js/master/static/src/jquery.js
// @require     https://raw.github.com/pchampin/ktbs4js/master/static/src/tracemanager.js
// ==/UserScript==

/*jslint vars:true */
/*global jQuery:true */

"use strict";

(function () {
    var TRACE_URI = "http://localhost:8001/b/t1/";
    console.log("Generic collector started on " + TRACE_URI);

    var $ = jQuery;
    if (typeof($) !== "function") {
        alert("Generic collector problem: $ = " + $)
    }

    var tr = window.tracemanager.init_trace("test", {
        url: TRACE_URI,
        requestmode: 'POST', // alternatives: "GET", "POST"
        syncmode: "delayed", // alternatives: "sync", "delayed"
        default_subject: "alice",
        format: "turtle", // alternatives: "turtle", "json", "json-compact"
        login: false,
    });

    $(window).unload(function() {
        var sync = tr.syncservice;
        sync.flush(false); // flushing asynchronously
    });
    
    function getXPath(element) {
        // derived from http://stackoverflow.com/a/3454579/1235487
        while (element && element.nodeType !== 1) {
            element = element.parentNode;
        }
        if (typeof(element) === "undefined") { return "(undefined)"; }
        if (element === null) { return "(null)"; }

        var xpath = '';
        for (true; element && element.nodeType === 1; element = element.parentNode) {
            //if (typeof(element.id) !== "undefined") return "#" + element.id;
            var id = ($(element.parentNode)
                      .children(element.tagName)
                      .index(element) + 1);
            id = (id > 1  ?  '[' + id + ']'  :  '');
            xpath = '/' + element.tagName.toLowerCase() + id + xpath;
        }
        return xpath;
    }

    function getElementName(element) {

        while (element && element.nodeType !== 1) {
            element = element.parentNode;
        }
        if (typeof(element) === "undefined") { return "(undefined)"; }
        if (element === null) { return "(null)"; }

        //if (typeof(element.id) !== "undefined") return "#" + element.id;
        var id = ($(element.parentNode)
                  .children(element.tagName)
                  .index(element) + 1);
        id = (id > 1  ?  '[' + id + ']'  :  '');
        var nameE = element.tagName.toLowerCase() + id;

        return nameE;
    }

    function getElementId(element) {

        while (element && element.nodeType !== 1) {
            element = element.parentNode;
        }
        if (typeof(element) === "undefined") { return "(undefined)"; }
        if (element === null) { return "(null)"; }

        if (typeof(element.id) !== "undefined") { return element.id; }

        return "#";
    }

    function fillCommonAttributes(e, attributes) {
        attributes.eventType = e.type;
        attributes.url = document.URL;
        attributes.ctrl = e.ctrlKey;
        attributes.shift = e.shiftKey;
        attributes.target = getXPath(e.target);
        attributes.targetName = getElementName(e.target);
        if (e.target.id) { attributes.targetId = e.target.text; }
        if (e.target.text) { attributes.targetText = e.target.text; }
        if (e.currentTarget) {
            attributes.currentTarget = getXPath(e.currentTarget);
            attributes.currentTargetName = getElementName(e.currentTarget);
            if (e.currentTarget.id) {
                attributes.currentTargetId = getElementId(e.currentTarget);
            }
            if (e.currentTarget.text) {
                attributes.currentTargetText = e.currentTarget.text;
            }
        }
        if (e.explicitOriginalTarget) {
            attributes.originalTarget = getXPath(e.explicitOriginalTarget);
            attributes.originalTargetName = getElementName(e.explicitOriginalTarget);
            if (e.explicitOriginalTarget.id) {
                attributes.originalTargetId = getElementId(e.explicitOriginalTarget);
            }
            if (e.explicitOriginalTarget.text) {
                attributes.originalTargetText = e.explicitOriginalTarget.text;
            }
        }
    }


    document.onkeypress = function (e) {
        var attributes = {
            'codeChar': String.fromCharCode(e.which),
        };
        fillCommonAttributes(e, attributes);
        tr.trace('KeyPress', attributes);
    };

    document.onclick = function (e) {
        var attributes = {
            'x': e.clientX,
            'y': e.clientY,
        };
        fillCommonAttributes(e, attributes);
        tr.trace('MouseEvent', attributes);
    };

}());
