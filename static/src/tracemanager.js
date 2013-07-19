/*
 * Modelled Trace API
 *
 * This file is part of ktbs4js.
 *
 * ktbs4js is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * ktbs4js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with ktbs4js.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
/* FIXME: properly use require.js feature. This will do for debugging in the meantime */
window.tracemanager = (function($) {
     // If there are more than MAX_FAILURE_COUNT synchronisation
     // failures, then disable synchronisation
     MAX_FAILURE_COUNT = 20;

     // If there are more than MAX_BUFFER_SIZE obsels in the buffer,
     // then "compress" them as a single "ktbsFullBuffer"
     MAX_BUFFER_SIZE = 500;

     var logmsg = function() {
         if (window.console) {
             window.console.log.apply(console, [ "ktbs4js" ].concat([].slice.call(arguments)));
         }
     };

     var BufferedService = function(url, mode, format, handshake) {
         this.url = url;
         this.buffer = [];
         this.isReady = !handshake;
         this.timer = null;
         this.failureCount = 0;
         // sync_mode is either "none", "sync" or "buffered"
         this.sync_mode = "none";
         /* mode can be either POST or GET */
         if (mode == 'POST' || mode == 'GET')
             this.mode = mode;
         else
             this.mode = 'POST';
         /* Data format */
         this.format = (this.mode === 'GET' ? 'json-compact' : 'json');
         if (format !== undefined)
             this.format = format;
         /* Flush buffer every timeOut ms if the sync_mode is delayed */
         this.timeOut = 2000;
     };
     BufferedService.prototype = {
         /*
          *  Buffered service for traces
          */
         // url: "",
         // buffer: [],
         // isReady: false,
         // timer: null,
         // failureCount: 0,

         /* Flush buffer */
         flush: function() {
             // FIXME: add mutex on this.buffer
             if (! this.isReady)
             {
                 logmsg("Sync service not ready");
             } else if (this.failureCount > MAX_FAILURE_COUNT)
             {
                 logmsg("Too many failures, disabling trace synchronisation");
                 // Disable synchronisation
                 this.set_sync_mode('none');
             } else if (this.buffer.length) {
                 var temp = this.buffer;
                 this.buffer = [];
                 var content_type = 'application/json';
                 var data;

                 if (this.format === 'turtle') {
                     content_type = "text/turtle";
                     data = [ "@prefix : <http://liris.cnrs.fr/silex/2009/ktbs#>.\n",
                              // Assume that the model for a trace has for URI <trace_uri> + "model#"
                              "@prefix m: <model#>.\n" ]
                         .concat(temp.map(function(o) { return o.toTurtle(); }))
                         .join("\n");
                 } else if (this.format === 'json-compact') {
                     content_type = "application/x-json-compact";
                     // We mark the "compressed" nature of the
                     // generated JSON by prefixing it with c
                     data = 'c' + JSON.stringify(temp.map(function (o) { return o.toCompactJSON(); }));
                     // Swap " (very frequent, which will be
                     // serialized into %22) and ; (rather rare), this
                     // saves some bytes
                     data = data.replace(/[;"#]/g, function(s){ return s == ';' ? '"' : ( s == '"' ? ';' : '%23'); });
                 } else {
                     // Default format: json
                     data = JSON.stringify(temp.map(function (o) { return o.toJSON(); }));
                 }

                 if (this.mode == 'GET')
                 {
                     data = "post=" + encodeURIComponent(data);
                     if (content_type !== 'application/x-json-compact')
                         data = 'content-type=' + content_type + '&' + data;
                     // FIXME: check data length (< 2K is safe)
                     var request=$('<img />').error( function() { this.failureCount += 1; })
                         .load( function() { this.failureCount = 0; })
                         .attr('src', this.url + '?' + data);
                 }
                 else
                 {
                     $.ajax({ url: this.url,
                              type: 'POST',
                              contentType: content_type,
                              data: data,
                              processData: false,
                              // Type of the returned data.
                              dataType: "text",
                              error: function(jqXHR, textStatus, errorThrown) {
                                  logmsg("Error when sending buffer:", textStatus + ' ' + JSON.stringify(errorThrown));
                                  this.failureCount += 1;
                              },
                              success: function(data, textStatus, jqXHR) {
                                  // Reset failureCount to 0 as soon as there is 1 valid answer
                                  this.failureCount = 0;
                              }
                            });
                 }
             }
         },

         /* Sync mode: delayed, sync (immediate sync), none (no
          * synchronisation with server, the trace has to be explicitly saved
          * if needed */
         set_sync_mode: function(mode, default_subject) {
             this.sync_mode = mode;
             if (! this.isReady && mode !== "none")
                 this.init(default_subject);
             if (mode == 'delayed') {
                 this.start_timer();
             } else {
                 this.stop_timer();
             }
         },

         /* Enqueue an obsel */
         enqueue: function(obsel) {
             if (this.buffer.length > MAX_BUFFER_SIZE)
             {
                 obsel = new Obsel('ktbsFullBuffer', this.buffer[0].begin,
                                   this.buffer[this.buffer.length - 1].end, this.buffer[0].subject);
                 obsel.trace = this.buffer[0].trace;
                 this.buffer = [];
             }
             this.buffer.push(obsel);
             if (this.sync_mode === 'sync') {
                 // Immediate sync of the obsel.
                 this.flush();
             }
         },

         start_timer: function() {
             var self = this;
             if (this.timer === null) {
                 this.timer = window.setInterval(function() {
                                                     self.flush();
                                                 }, this.timeOut);
             }
         },

         stop_timer: function() {
             if (this.timer !== null) {
                 window.clearInterval(this.timer);
                 this.timer = null;
             }
         },

         /*
          * Initialize the sync service
          */
         init: function(default_subject) {
             var self = this;
             if (this.isReady)
                 /* Already initialized */
                 return;
             if (typeof default_subject === 'undefined' || default_subject == "")
             {
                 this.isReady = true;
                 return;
             }
             if (this.mode == 'GET')
             {
                 var request=$('<img/>').attr('src', this.url + 'login?userinfo={"default_subject": "' + default_subject + '"}');
                 // Do not wait for the return, assume it is
                 // initialized. This assumption will not work anymore
                 // if login returns some necessary information
                 this.isReady = true;
             }
             else
             {
                 $.ajax({ url: this.url + 'login',
                          type: 'POST',
                          data: 'userinfo={"default_subject":"' + default_subject + '"}',
                          success: function(data, textStatus, jqXHR) {
                              self.isReady = true;
                              if (self.buffer.length) {
                                  self.flush();
                              }
                          }
                        });
             }
         }
     };

     var Trace = function(uri, requestmode, format, handshake) {
         /* FIXME: We could/should use a sorted list such as
          http://closure-library.googlecode.com/svn/docs/class_goog_structs_AvlTree.html
          to speed up queries based on time */
         this.obsels = [];
         /* Trace URI */
         if (uri === undefined)
             uri = "";
         this.uri = uri;
         this.sync_mode = "none";
         this.default_subject = "";
         this.shorthands = {};
         /* baseuri is used a the base URI to resolve relative attribute names in obsels */
         this.baseuri = "";

         this.syncservice = new BufferedService(uri, requestmode, format, handshake);
         $(window).unload( function () {
                               if (this.syncservice && this.sync_mode !== 'none') {
                                   this.syncservice.flush();
                                   this.syncservice.stop_timer();
                               }
                           });
     };
     Trace.prototype = {
         /* FIXME: We could/should use a sorted list such as
          http://closure-library.googlecode.com/svn/docs/class_goog_structs_AvlTree.html
          to speed up queries based on time */
         obsels: [],
         /* Trace URI */
         uri: "",
         default_subject: "",
         /* baseuri is used as the base URI to resolve relative
          * attribute-type names in obsels. Strictly speaking, this
          * should rather be expressed as a reference to model, or
          * more generically, as a qname/URI dict */
         baseuri: "",
         /* Mapping of obsel type or property name to a compact
          * representation (shorthands).
          */
         shorthands: null,
         syncservice: null,

         /* Define the trace URI */
         set_uri: function(uri) {
             this.uri = uri;
         },

         /* Sync mode: delayed, sync (immediate sync), none (no
          * synchronisation with server, the trace has to be explicitly saved
          * if needed */
         set_sync_mode: function(mode) {
             if (this.syncservice !== null) {
                 this.syncservice.set_sync_mode(mode, this.default_subject);
             }
         },

         /*
          * Return a list of the obsels of this trace matching the parameters
          */
         list_obsels: function(_begin, _end, _reverse) {
             var res;
             if (typeof _begin !== 'undefined' || typeof _end !== 'undefined') {
                 /*
                  * Not optimized yet.
                  */
                 res = [];
                 var l = this.obsels.length;
                 for (var i = 0; i < l; i++) {
                     var o = this.obsels[i];
                     if ((typeof _begin !== 'undefined' && o.begin > _begin) && (typeof _end !== 'undefined' && o.end < _end)) {
                         res.push(o);
                     }
                 }
             }

             if (typeof _reverse !== 'undefined') {
                 if (res !== undefined) {
                     /* Should reverse the whole list. Make a copy. */
                     res = this.obsels.slice(0);
                 }
                 res.sort(function(a, b) { return b.begin - a.begin; });
                 return res;
             }

             if (res === undefined) {
                 res = this.obsels;
             }
             return res;

         },

         /*
          * Return the obsel of this trace identified by the URI, or undefined
          */
         get_obsel: function(id) {
             for (var i = 0; i < this.obsels.length; i++) {
                 /* FIXME: should check against variations of id/uri, take this.baseuri into account */
                 if (this.obsels[i].uri === id) {
                     return this.obsels[i];
                 }
             }
             return undefined;
         },

         set_default_subject: function(subject) {
             // FIXME: if we call this method after the sync_service
             // init method, then the default_subject will not be
             // consistent anymore. Maybe we should then call init() again?
             this.default_subject = subject;
         },

         get_default_subject: function() {
             return this.default_subject;
         },

         /* (type:ObselType, begin:int, end:int?, subject:str?, attributes:[AttributeType=>any]?) */
         /* Create a new obsel and add it to the trace */
         create_obsel: function(type, begin, end, subject, _attributes) {
             var o = new Obsel(type, begin, end, subject);
             if (typeof _attributes !== 'undefined') {
                 o.attributes = _attributes;
             }
             o.trace = this;
             this.obsels.push(o);
             if (this.syncservice !== null)
                 this.syncservice.enqueue(o);
         },

         /* Helper methods */

         /* Create a new obsel with the given attributes */
         trace: function(type, _attributes, _begin, _end, _subject) {
             var t = (new Date()).getTime();
             if (typeof begin === 'undefined') {
                 _begin = t;
             }
             if (typeof end === 'undefined') {
                 _end = _begin;
             }
             if (typeof subject === 'undefined') {
                 _subject = this.default_subject;
             }
             if (typeof _attributes === 'undefined') {
                 _attributes = {};
             }
             return this.create_obsel(type, _begin, _end, _subject, _attributes);
         }
     };

     var Obsel = function(type, begin, end, subject, attributes) {
         this.trace = undefined;
         this.uri = "";
         this.id = "";
         this.type = type;
         this.begin = begin;
         this.end = end;
         this.subject = subject;
         /* Is the obsel synched with the server ? */
         this.sync_status = false;
         /* Dictionary indexed by ObselType URIs */
         this.attributes = {};
     };
     Obsel.prototype = {
         /* The following attributes are here for documentation
          * purposes. They MUST be defined in the constructor
          * function. */
         trace: undefined,
         type: undefined,
         begin: undefined,
         end: undefined,
         subject: undefined,
         /* Dictionary indexed by ObselType URIs */
         attributes: {},

         /* Method definitions */
         get_trace: function() {
             return this.trace;
         },

         get_obsel_type: function() {
             return this.type;
         },
         get_begin: function() {
             return this.begin;
         },
         get_end: function() {
             return this.end;
         },
         get_subject: function() {
             return this.subject;
         },

         list_attribute_types: function() {
             var result = [];
             for (var prop in this.attributes) {
                 if (this.attributes.hasOwnProperty(prop))
                     result.push(prop);
             }
             /* FIXME: we return URIs here instead of AttributeType elements */
             return result;
         },

         list_relation_types: function() {
             /* FIXME: not implemented yet */
         },

         list_related_obsels: function (rt) {
             /* FIXME: not implemented yet */
         },
         list_inverse_relation_types: function () {
             /* FIXME: not implemented yet */
         },
         list_relating_obsels: function (rt) {
             /* FIXME: not implemented yet */
         },
         /*
          * Return the value of the given attribute type for this obsel
          */
         get_attribute_value: function(at) {
             if (typeof at === "string")
                 /* It is a URI */
                 return this.attributes[at];
             else
                 /* FIXME: check that at is instance of AttributeType */
                 return this.attributes[at.uri];
         },


         /* obsel modification (trace amendment) */

         set_attribute_value: function(at, value) {
             if (typeof at === "string")
                 /* It is a URI */
                 this.attributes[at] = value;
             /* FIXME: check that at is instance of AttributeType */
             else
                 this.attributes[at.uri] = value;
         },

         del_attribute_value: function(at) {
             if (typeof at === "string")
                 /* It is a URI */
                 delete this.attributes[at];
             /* FIXME: check that at is instance of AttributeType */
             else
                 delete this.attributes[at.uri];
         },

         add_related_obsel: function(rt, value) {
             /* FIXME: not implemented yet */
         },

         del_related_obsel: function(rt, value) {
             /* FIXME: not implemented yet */
         },

         /*
          * Return a JSON representation of the obsel
          */
         toJSON: function() {
             var r = {
                 "@id": this.id,
                 "@type": this.type,
                 "begin": this.begin,
                 "end": this.end,
                 "subject": this.subject
             };
             for (var prop in this.attributes) {
                 if (this.attributes.hasOwnProperty(prop))
                     r[prop] = this.attributes[prop];
             }
             return r;
         },

         /*
          * Return a compact JSON representation of the obsel.
          * Use predefined + custom shorthands for types/properties
          */
         toCompactJSON: function() {
             var r = {
                 "@t": (this.trace.shorthands.hasOwnProperty(this.type) ? this.trace.shorthands[this.type] : this.type),
                 "@b": this.begin
             };
             // Transmit subject only if different from default_subject
             if (this.subject !== this.trace.default_subject)
                 r["@s"] = this.subject;

             // Store duration (to save some bytes) and only if it is non-null
             if (this.begin !== this.end)
                 r["@d"] = this.end - this.begin;

             // Store id only if != ""
             if (this.id !== "")
                 r["@i"] = this.id;

             for (var prop in this.attributes) {
                 if (this.attributes.hasOwnProperty(prop))
                 {
                     var v = this.attributes[prop];
                     r[prop] = this.trace.shorthands.hasOwnProperty(v) ? this.trace.shorthands[v] : v;
                 }
             }
             return r;
         },

         toJSONstring: function() {
             return JSON.stringify(this.toJSON());
         },

        /*
         * Return a Turtle representation of the obsel,
         * assuming that : is bound to the KTBS namespace,
         * and that m: is bound to the model namespace.
         */
        toTurtle: function () {
            var prop;
            var data = [ "[ :hasTrace <> ;",
                         "  a m:" + this.type + " ;" ];
            if (this.begin) { data.push("  :hasBegin " + this.begin + " ;"); }
            if (this.end) { data.push("  :hasEnd " + this.end + " ;"); }
            if (this.subject) { data.push("  :hasSubject \"" + this.subject + "\" ;"); }
            for (prop in this.attributes) {
                if (this.attributes.hasOwnProperty(prop)) {
                    data.push("  m:" + prop + " " + JSON.stringify(this.attributes[prop]));
                }
            }
            data.push("] .\n");
            return data.join("\n");
        }

     };

     var TraceManager = function() {
         this.traces = {};
     };
     TraceManager.prototype = {
         traces: [],
         /*
          * Return the trace with id name
          * If it was not registered, return undefined.
          */
         get_trace: function(name) {
             return this.traces[name];
         },

         /*
          * Explicitly create and initialize a new trace with the given name.
          * The optional uri parameter allows to initialize the trace URI.
          *
          * If another existed with the same name before, then it is replaced by a new one.
          */
         init_trace: function(name, params)
         {
             logmsg("init_trace", params);
             var url = params.url ? params.url : "";
             var requestmode = params.requestmode ? params.requestmode : "POST";
             var syncmode = params.syncmode ? params.syncmode : "none";
             var format = params.format || "json";
             var default_subject = params.default_subject || "";
             var handshake = params.handshake;
             var t = new Trace(url, requestmode, format, handshake);
             t.set_default_subject(default_subject);
             t.set_sync_mode(syncmode);
             this.traces[name] = t;
             return t;
         }
     };

     var tracemanager  = new TraceManager();
     return tracemanager;
 })(jQuery);
