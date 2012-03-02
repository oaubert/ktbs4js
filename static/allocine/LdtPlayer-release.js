/* 
 * 	
 *	Copyright 2010-2012 Institut de recherche et d'innovation 
 *	contributor(s) : Karim Hamidou, Samuel Huron 
 *	 
 *	contact@iri.centrepompidou.fr
 *	http://www.iri.centrepompidou.fr 
 *	 
 *	This software is a computer program whose purpose is to show and add annotations on a video .
 *	This software is governed by the CeCILL-C license under French law and
 *	abiding by the rules of distribution of free software. You can  use, 
 *	modify and/ or redistribute the software under the terms of the CeCILL-C
 *	license as circulated by CEA, CNRS and INRIA at the following URL
 *	"http://www.cecill.info". 
 *	
 *	The fact that you are presently reading this means that you have had
 *	knowledge of the CeCILL-C license and that you accept its terms.
*/
/*! LAB.js (LABjs :: Loading And Blocking JavaScript)
    v2.0.3 (c) Kyle Simpson
    MIT License
*/

(function(global){
	var _$LAB = global.$LAB,
	
		// constants for the valid keys of the options object
		_UseLocalXHR = "UseLocalXHR",
		_AlwaysPreserveOrder = "AlwaysPreserveOrder",
		_AllowDuplicates = "AllowDuplicates",
		_CacheBust = "CacheBust",
		/*!START_DEBUG*/_Debug = "Debug",/*!END_DEBUG*/
		_BasePath = "BasePath",
		
		// stateless variables used across all $LAB instances
		root_page = /^[^?#]*\//.exec(location.href)[0],
		root_domain = /^\w+\:\/\/\/?[^\/]+/.exec(root_page)[0],
		append_to = document.head || document.getElementsByTagName("head"),
		
		// inferences... ick, but still necessary
		opera_or_gecko = (global.opera && Object.prototype.toString.call(global.opera) == "[object Opera]") || ("MozAppearance" in document.documentElement.style),

/*!START_DEBUG*/
		// console.log() and console.error() wrappers
		log_msg = function(){}, 
		log_error = log_msg,
/*!END_DEBUG*/
		
		// feature sniffs (yay!)
		test_script_elem = document.createElement("script"),
		explicit_preloading = typeof test_script_elem.preload == "boolean", // http://wiki.whatwg.org/wiki/Script_Execution_Control#Proposal_1_.28Nicholas_Zakas.29
		real_preloading = explicit_preloading || (test_script_elem.readyState && test_script_elem.readyState == "uninitialized"), // will a script preload with `src` set before DOM append?
		script_ordered_async = !real_preloading && test_script_elem.async === true, // http://wiki.whatwg.org/wiki/Dynamic_Script_Execution_Order
		
		// XHR preloading (same-domain) and cache-preloading (remote-domain) are the fallbacks (for some browsers)
		xhr_or_cache_preloading = !real_preloading && !script_ordered_async && !opera_or_gecko
	;

/*!START_DEBUG*/
	// define console wrapper functions if applicable
	if (global.console && global.console.log) {
		if (!global.console.error) global.console.error = global.console.log;
		log_msg = function(msg) { global.console.log(msg); };
		log_error = function(msg,err) { global.console.error(msg,err); };
	}
/*!END_DEBUG*/

	// test for function
	function is_func(func) { return Object.prototype.toString.call(func) == "[object Function]"; }

	// test for array
	function is_array(arr) { return Object.prototype.toString.call(arr) == "[object Array]"; }

	// make script URL absolute/canonical
	function canonical_uri(src,base_path) {
		var absolute_regex = /^\w+\:\/\//;
		
		// is `src` is protocol-relative (begins with // or ///), prepend protocol
		if (/^\/\/\/?/.test(src)) {
			src = location.protocol + src;
		}
		// is `src` page-relative? (not an absolute URL, and not a domain-relative path, beginning with /)
		else if (!absolute_regex.test(src) && src.charAt(0) != "/") {
			// prepend `base_path`, if any
			src = (base_path || "") + src;
		}
		// make sure to return `src` as absolute
		return absolute_regex.test(src) ? src : ((src.charAt(0) == "/" ? root_domain : root_page) + src);
	}

	// merge `source` into `target`
	function merge_objs(source,target) {
		for (var k in source) { if (source.hasOwnProperty(k)) {
			target[k] = source[k]; // TODO: does this need to be recursive for our purposes?
		}}
		return target;
	}

	// does the chain group have any ready-to-execute scripts?
	function check_chain_group_scripts_ready(chain_group) {
		var any_scripts_ready = false;
		for (var i=0; i<chain_group.scripts.length; i++) {
			if (chain_group.scripts[i].ready && chain_group.scripts[i].exec_trigger) {
				any_scripts_ready = true;
				chain_group.scripts[i].exec_trigger();
				chain_group.scripts[i].exec_trigger = null;
			}
		}
		return any_scripts_ready;
	}

	// creates a script load listener
	function create_script_load_listener(elem,registry_item,flag,onload) {
		elem.onload = elem.onreadystatechange = function() {
			if ((elem.readyState && elem.readyState != "complete" && elem.readyState != "loaded") || registry_item[flag]) return;
			elem.onload = elem.onreadystatechange = null;
			onload();
		};
	}

	// script executed handler
	function script_executed(registry_item) {
		registry_item.ready = registry_item.finished = true;
		for (var i=0; i<registry_item.finished_listeners.length; i++) {
			registry_item.finished_listeners[i]();
		}
		registry_item.ready_listeners = [];
		registry_item.finished_listeners = [];
	}

	// make the request for a scriptha
	function request_script(chain_opts,script_obj,registry_item,onload,preload_this_script) {
		// setTimeout() "yielding" prevents some weird race/crash conditions in older browsers
		setTimeout(function(){
			var script, src = script_obj.real_src, xhr;
			
			// don't proceed until `append_to` is ready to append to
			if ("item" in append_to) { // check if `append_to` ref is still a live node list
				if (!append_to[0]) { // `append_to` node not yet ready
					// try again in a little bit -- note: will re-call the anonymous function in the outer setTimeout, not the parent `request_script()`
					setTimeout(arguments.callee,25);
					return;
				}
				// reassign from live node list ref to pure node ref -- avoids nasty IE bug where changes to DOM invalidate live node lists
				append_to = append_to[0];
			}
			script = document.createElement("script");
			if (script_obj.type) script.type = script_obj.type;
			if (script_obj.charset) script.charset = script_obj.charset;
			
			// should preloading be used for this script?
			if (preload_this_script) {
				// real script preloading?
				if (real_preloading) {
					/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("start script preload: "+src);/*!END_DEBUG*/
					registry_item.elem = script;
					if (explicit_preloading) { // explicit preloading (aka, Zakas' proposal)
						script.preload = true;
						script.onpreload = onload;
					}
					else {
						script.onreadystatechange = function(){
							if (script.readyState == "loaded") onload();
						};
					}
					script.src = src;
					// NOTE: no append to DOM yet, appending will happen when ready to execute
				}
				// same-domain and XHR allowed? use XHR preloading
				else if (preload_this_script && src.indexOf(root_domain) == 0 && chain_opts[_UseLocalXHR]) {
					xhr = new XMLHttpRequest(); // note: IE never uses XHR (it supports true preloading), so no more need for ActiveXObject fallback for IE <= 7
					/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("start script preload (xhr): "+src);/*!END_DEBUG*/
					xhr.onreadystatechange = function() {
						if (xhr.readyState == 4) {
							xhr.onreadystatechange = function(){}; // fix a memory leak in IE
							registry_item.text = xhr.responseText + "\n//@ sourceURL=" + src; // http://blog.getfirebug.com/2009/08/11/give-your-eval-a-name-with-sourceurl/
							onload();
						}
					};
					xhr.open("GET",src);
					xhr.send();
				}
				// as a last resort, use cache-preloading
				else {
					/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("start script preload (cache): "+src);/*!END_DEBUG*/
					script.type = "text/cache-script";
					create_script_load_listener(script,registry_item,"ready",function() {
						append_to.removeChild(script);
						onload();
					});
					script.src = src;
					append_to.insertBefore(script,append_to.firstChild);
				}
			}
			// use async=false for ordered async? parallel-load-serial-execute http://wiki.whatwg.org/wiki/Dynamic_Script_Execution_Order
			else if (script_ordered_async) {
				/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("start script load (ordered async): "+src);/*!END_DEBUG*/
				script.async = false;
				create_script_load_listener(script,registry_item,"finished",onload);
				script.src = src;
				append_to.insertBefore(script,append_to.firstChild);
			}
			// otherwise, just a normal script element
			else {
				/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("start script load: "+src);/*!END_DEBUG*/
				create_script_load_listener(script,registry_item,"finished",onload);
				script.src = src;
				append_to.insertBefore(script,append_to.firstChild);
			}
		},0);
	}
		
	// create a clean instance of $LAB
	function create_sandbox() {
		var global_defaults = {},
			can_use_preloading = real_preloading || xhr_or_cache_preloading,
			queue = [],
			registry = {},
			instanceAPI
		;
		
		// global defaults
		global_defaults[_UseLocalXHR] = true;
		global_defaults[_AlwaysPreserveOrder] = false;
		global_defaults[_AllowDuplicates] = false;
		global_defaults[_CacheBust] = false;
		/*!START_DEBUG*/global_defaults[_Debug] = false;/*!END_DEBUG*/
		global_defaults[_BasePath] = "";

		// execute a script that has been preloaded already
		function execute_preloaded_script(chain_opts,script_obj,registry_item) {
			var script;
			
			function preload_execute_finished() {
				if (script != null) { // make sure this only ever fires once
					script = null;
					script_executed(registry_item);
				}
			}
			
			if (registry[script_obj.src].finished) return;
			if (!chain_opts[_AllowDuplicates]) registry[script_obj.src].finished = true;
			
			script = registry_item.elem || document.createElement("script");
			if (script_obj.type) script.type = script_obj.type;
			if (script_obj.charset) script.charset = script_obj.charset;
			create_script_load_listener(script,registry_item,"finished",preload_execute_finished);
			
			// script elem was real-preloaded
			if (registry_item.elem) {
				registry_item.elem = null;
			}
			// script was XHR preloaded
			else if (registry_item.text) {
				script.onload = script.onreadystatechange = null;	// script injection doesn't fire these events
				script.text = registry_item.text;
			}
			// script was cache-preloaded
			else {
				script.src = script_obj.real_src;
			}
			append_to.insertBefore(script,append_to.firstChild);

			// manually fire execution callback for injected scripts, since events don't fire
			if (registry_item.text) {
				preload_execute_finished();
			}
		}
	
		// process the script request setup
		function do_script(chain_opts,script_obj,chain_group,preload_this_script) {
			var registry_item,
				registry_items,
				ready_cb = function(){ script_obj.ready_cb(script_obj,function(){ execute_preloaded_script(chain_opts,script_obj,registry_item); }); },
				finished_cb = function(){ script_obj.finished_cb(script_obj,chain_group); }
			;
			
			script_obj.src = canonical_uri(script_obj.src,chain_opts[_BasePath]);
			script_obj.real_src = script_obj.src + 
				// append cache-bust param to URL?
				(chain_opts[_CacheBust] ? ((/\?.*$/.test(script_obj.src) ? "&_" : "?_") + ~~(Math.random()*1E9) + "=") : "")
			;
			
			if (!registry[script_obj.src]) registry[script_obj.src] = {items:[],finished:false};
			registry_items = registry[script_obj.src].items;

			// allowing duplicates, or is this the first recorded load of this script?
			if (chain_opts[_AllowDuplicates] || registry_items.length == 0) {
				registry_item = registry_items[registry_items.length] = {
					ready:false,
					finished:false,
					ready_listeners:[ready_cb],
					finished_listeners:[finished_cb]
				};

				request_script(chain_opts,script_obj,registry_item,
					// which callback type to pass?
					(
					 	(preload_this_script) ? // depends on script-preloading
						function(){
							registry_item.ready = true;
							for (var i=0; i<registry_item.ready_listeners.length; i++) {
								registry_item.ready_listeners[i]();
							}
							registry_item.ready_listeners = [];
						} :
						function(){ script_executed(registry_item); }
					),
					// signal if script-preloading should be used or not
					preload_this_script
				);
			}
			else {
				registry_item = registry_items[0];
				if (registry_item.finished) {
					finished_cb();
				}
				else {
					registry_item.finished_listeners.push(finished_cb);
				}
			}
		}

		// creates a closure for each separate chain spawned from this $LAB instance, to keep state cleanly separated between chains
		function create_chain() {
			var chainedAPI,
				chain_opts = merge_objs(global_defaults,{}),
				chain = [],
				exec_cursor = 0,
				scripts_currently_loading = false,
				group
			;
			
			// called when a script has finished preloading
			function chain_script_ready(script_obj,exec_trigger) {
				/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("script preload finished: "+script_obj.real_src);/*!END_DEBUG*/
				script_obj.ready = true;
				script_obj.exec_trigger = exec_trigger;
				advance_exec_cursor(); // will only check for 'ready' scripts to be executed
			}

			// called when a script has finished executing
			function chain_script_executed(script_obj,chain_group) {
				/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("script execution finished: "+script_obj.real_src);/*!END_DEBUG*/
				script_obj.ready = script_obj.finished = true;
				script_obj.exec_trigger = null;
				// check if chain group is all finished
				for (var i=0; i<chain_group.scripts.length; i++) {
					if (!chain_group.scripts[i].finished) return;
				}
				// chain_group is all finished if we get this far
				chain_group.finished = true;
				advance_exec_cursor();
			}

			// main driver for executing each part of the chain
			function advance_exec_cursor() {
				while (exec_cursor < chain.length) {
					if (is_func(chain[exec_cursor])) {
						/*!START_DEBUG*/if (chain_opts[_Debug]) log_msg("$LAB.wait() executing: "+chain[exec_cursor]);/*!END_DEBUG*/
						try { chain[exec_cursor++](); } catch (err) {
							/*!START_DEBUG*/if (chain_opts[_Debug]) log_error("$LAB.wait() error caught: ",err);/*!END_DEBUG*/
						}
						continue;
					}
					else if (!chain[exec_cursor].finished) {
						if (check_chain_group_scripts_ready(chain[exec_cursor])) continue;
						break;
					}
					exec_cursor++;
				}
				// we've reached the end of the chain (so far)
				if (exec_cursor == chain.length) {
					scripts_currently_loading = false;
					group = false;
				}
			}
			
			// setup next chain script group
			function init_script_chain_group() {
				if (!group || !group.scripts) {
					chain.push(group = {scripts:[],finished:true});
				}
			}

			// API for $LAB chains
			chainedAPI = {
				// start loading one or more scripts
				script:function(){
					for (var i=0; i<arguments.length; i++) {
						(function(script_obj,script_list){
							var splice_args;
							
							if (!is_array(script_obj)) {
								script_list = [script_obj];
							}
							for (var j=0; j<script_list.length; j++) {
								init_script_chain_group();
								script_obj = script_list[j];
								
								if (is_func(script_obj)) script_obj = script_obj();
								if (!script_obj) continue;
								if (is_array(script_obj)) {
									// set up an array of arguments to pass to splice()
									splice_args = [].slice.call(script_obj); // first include the actual array elements we want to splice in
									splice_args.unshift(j,1); // next, put the `index` and `howMany` parameters onto the beginning of the splice-arguments array
									[].splice.apply(script_list,splice_args); // use the splice-arguments array as arguments for splice()
									j--; // adjust `j` to account for the loop's subsequent `j++`, so that the next loop iteration uses the same `j` index value
									continue;
								}
								if (typeof script_obj == "string") script_obj = {src:script_obj};
								script_obj = merge_objs(script_obj,{
									ready:false,
									ready_cb:chain_script_ready,
									finished:false,
									finished_cb:chain_script_executed
								});
								group.finished = false;
								group.scripts.push(script_obj);
								
								do_script(chain_opts,script_obj,group,(can_use_preloading && scripts_currently_loading));
								scripts_currently_loading = true;
								
								if (chain_opts[_AlwaysPreserveOrder]) chainedAPI.wait();
							}
						})(arguments[i],arguments[i]);
					}
					return chainedAPI;
				},
				// force LABjs to pause in execution at this point in the chain, until the execution thus far finishes, before proceeding
				wait:function(){
					if (arguments.length > 0) {
						for (var i=0; i<arguments.length; i++) {
							chain.push(arguments[i]);
						}
						group = chain[chain.length-1];
					}
					else group = false;
					
					advance_exec_cursor();
					
					return chainedAPI;
				}
			};

			// the first chain link API (includes `setOptions` only this first time)
			return {
				script:chainedAPI.script, 
				wait:chainedAPI.wait, 
				setOptions:function(opts){
					merge_objs(opts,chain_opts);
					return chainedAPI;
				}
			};
		}

		// API for each initial $LAB instance (before chaining starts)
		instanceAPI = {
			// main API functions
			setGlobalDefaults:function(opts){
				merge_objs(opts,global_defaults);
				return instanceAPI;
			},
			setOptions:function(){
				return create_chain().setOptions.apply(null,arguments);
			},
			script:function(){
				return create_chain().script.apply(null,arguments);
			},
			wait:function(){
				return create_chain().wait.apply(null,arguments);
			},

			// built-in queuing for $LAB `script()` and `wait()` calls
			// useful for building up a chain programmatically across various script locations, and simulating
			// execution of the chain
			queueScript:function(){
				queue[queue.length] = {type:"script", args:[].slice.call(arguments)};
				return instanceAPI;
			},
			queueWait:function(){
				queue[queue.length] = {type:"wait", args:[].slice.call(arguments)};
				return instanceAPI;
			},
			runQueue:function(){
				var $L = instanceAPI, len=queue.length, i=len, val;
				for (;--i>=0;) {
					val = queue.shift();
					$L = $L[val.type].apply(null,val.args);
				}
				return $L;
			},

			// rollback `[global].$LAB` to what it was before this file was loaded, the return this current instance of $LAB
			noConflict:function(){
				global.$LAB = _$LAB;
				return instanceAPI;
			},

			// create another clean instance of $LAB
			sandbox:function(){
				return create_sandbox();
			}
		};

		return instanceAPI;
	}

	// create the main instance of $LAB
	global.$LAB = create_sandbox();


	/* The following "hack" was suggested by Andrea Giammarchi and adapted from: http://webreflection.blogspot.com/2009/11/195-chars-to-help-lazy-loading.html
	   NOTE: this hack only operates in FF and then only in versions where document.readyState is not present (FF < 3.6?).
	   
	   The hack essentially "patches" the **page** that LABjs is loaded onto so that it has a proper conforming document.readyState, so that if a script which does 
	   proper and safe dom-ready detection is loaded onto a page, after dom-ready has passed, it will still be able to detect this state, by inspecting the now hacked 
	   document.readyState property. The loaded script in question can then immediately trigger any queued code executions that were waiting for the DOM to be ready. 
	   For instance, jQuery 1.4+ has been patched to take advantage of document.readyState, which is enabled by this hack. But 1.3.2 and before are **not** safe or 
	   fixed by this hack, and should therefore **not** be lazy-loaded by script loader tools such as LABjs.
	*/ 
	(function(addEvent,domLoaded,handler){
		if (document.readyState == null && document[addEvent]){
			document.readyState = "loading";
			document[addEvent](domLoaded,handler = function(){
				document.removeEventListener(domLoaded,handler,false);
				document.readyState = "complete";
			},false);
		}
	})("addEventListener","DOMContentLoaded");

})(this);/*
  mustache.js — Logic-less templates in JavaScript

  See http://mustache.github.com/ for more info.
*/

var Mustache = function () {
  var _toString = Object.prototype.toString;

  Array.isArray = Array.isArray || function (obj) {
    return _toString.call(obj) == "[object Array]";
  }

  var _trim = String.prototype.trim, trim;

  if (_trim) {
    trim = function (text) {
      return text == null ? "" : _trim.call(text);
    }
  } else {
    var trimLeft, trimRight;

    // IE doesn't match non-breaking spaces with \s.
    if ((/\S/).test("\xA0")) {
      trimLeft = /^[\s\xA0]+/;
      trimRight = /[\s\xA0]+$/;
    } else {
      trimLeft = /^\s+/;
      trimRight = /\s+$/;
    }

    trim = function (text) {
      return text == null ? "" :
        text.toString().replace(trimLeft, "").replace(trimRight, "");
    }
  }

  var escapeMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHTML(string) {
    return String(string).replace(/&(?!\w+;)|[<>"']/g, function (s) {
      return escapeMap[s] || s;
    });
  }

  var regexCache = {};
  var Renderer = function () {};

  Renderer.prototype = {
    otag: "{{",
    ctag: "}}",
    pragmas: {},
    buffer: [],
    pragmas_implemented: {
      "IMPLICIT-ITERATOR": true
    },
    context: {},

    render: function (template, context, partials, in_recursion) {
      // reset buffer & set context
      if (!in_recursion) {
        this.context = context;
        this.buffer = []; // TODO: make this non-lazy
      }

      // fail fast
      if (!this.includes("", template)) {
        if (in_recursion) {
          return template;
        } else {
          this.send(template);
          return;
        }
      }

      // get the pragmas together
      template = this.render_pragmas(template);

      // render the template
      var html = this.render_section(template, context, partials);

      // render_section did not find any sections, we still need to render the tags
      if (html === false) {
        html = this.render_tags(template, context, partials, in_recursion);
      }

      if (in_recursion) {
        return html;
      } else {
        this.sendLines(html);
      }
    },

    /*
      Sends parsed lines
    */
    send: function (line) {
      if (line !== "") {
        this.buffer.push(line);
      }
    },

    sendLines: function (text) {
      if (text) {
        var lines = text.split("\n");
        for (var i = 0; i < lines.length; i++) {
          this.send(lines[i]);
        }
      }
    },

    /*
      Looks for %PRAGMAS
    */
    render_pragmas: function (template) {
      // no pragmas
      if (!this.includes("%", template)) {
        return template;
      }

      var that = this;
      var regex = this.getCachedRegex("render_pragmas", function (otag, ctag) {
        return new RegExp(otag + "%([\\w-]+) ?([\\w]+=[\\w]+)?" + ctag, "g");
      });

      return template.replace(regex, function (match, pragma, options) {
        if (!that.pragmas_implemented[pragma]) {
          throw({message:
            "This implementation of mustache doesn't understand the '" +
            pragma + "' pragma"});
        }
        that.pragmas[pragma] = {};
        if (options) {
          var opts = options.split("=");
          that.pragmas[pragma][opts[0]] = opts[1];
        }
        return "";
        // ignore unknown pragmas silently
      });
    },

    /*
      Tries to find a partial in the curent scope and render it
    */
    render_partial: function (name, context, partials) {
      name = trim(name);
      if (!partials || partials[name] === undefined) {
        throw({message: "unknown_partial '" + name + "'"});
      }
      if (!context || typeof context[name] != "object") {
        return this.render(partials[name], context, partials, true);
      }
      return this.render(partials[name], context[name], partials, true);
    },

    /*
      Renders inverted (^) and normal (#) sections
    */
    render_section: function (template, context, partials) {
      if (!this.includes("#", template) && !this.includes("^", template)) {
        // did not render anything, there were no sections
        return false;
      }

      var that = this;

      var regex = this.getCachedRegex("render_section", function (otag, ctag) {
        // This regex matches _the first_ section ({{#foo}}{{/foo}}), and captures the remainder
        return new RegExp(
          "^([\\s\\S]*?)" +         // all the crap at the beginning that is not {{*}} ($1)

          otag +                    // {{
          "(\\^|\\#)\\s*(.+)\\s*" + //  #foo (# == $2, foo == $3)
          ctag +                    // }}

          "\n*([\\s\\S]*?)" +       // between the tag ($2). leading newlines are dropped

          otag +                    // {{
          "\\/\\s*\\3\\s*" +        //  /foo (backreference to the opening tag).
          ctag +                    // }}

          "\\s*([\\s\\S]*)$",       // everything else in the string ($4). leading whitespace is dropped.

        "g");
      });


      // for each {{#foo}}{{/foo}} section do...
      return template.replace(regex, function (match, before, type, name, content, after) {
        // before contains only tags, no sections
        var renderedBefore = before ? that.render_tags(before, context, partials, true) : "",

        // after may contain both sections and tags, so use full rendering function
            renderedAfter = after ? that.render(after, context, partials, true) : "",

        // will be computed below
            renderedContent,

            value = that.find(name, context);

        if (type === "^") { // inverted section
          if (!value || Array.isArray(value) && value.length === 0) {
            // false or empty list, render it
            renderedContent = that.render(content, context, partials, true);
          } else {
            renderedContent = "";
          }
        } else if (type === "#") { // normal section
          if (Array.isArray(value)) { // Enumerable, Let's loop!
            renderedContent = that.map(value, function (row) {
              return that.render(content, that.create_context(row), partials, true);
            }).join("");
          } else if (that.is_object(value)) { // Object, Use it as subcontext!
            renderedContent = that.render(content, that.create_context(value),
              partials, true);
          } else if (typeof value == "function") {
            // higher order section
            renderedContent = value.call(context, content, function (text) {
              return that.render(text, context, partials, true);
            });
          } else if (value) { // boolean section
            renderedContent = that.render(content, context, partials, true);
          } else {
            renderedContent = "";
          }
        }

        return renderedBefore + renderedContent + renderedAfter;
      });
    },

    /*
      Replace {{foo}} and friends with values from our view
    */
    render_tags: function (template, context, partials, in_recursion) {
      // tit for tat
      var that = this;

      var new_regex = function () {
        return that.getCachedRegex("render_tags", function (otag, ctag) {
          return new RegExp(otag + "(=|!|>|&|\\{|%)?([^#\\^]+?)\\1?" + ctag + "+", "g");
        });
      };

      var regex = new_regex();
      var tag_replace_callback = function (match, operator, name) {
        switch(operator) {
        case "!": // ignore comments
          return "";
        case "=": // set new delimiters, rebuild the replace regexp
          that.set_delimiters(name);
          regex = new_regex();
          return "";
        case ">": // render partial
          return that.render_partial(name, context, partials);
        case "{": // the triple mustache is unescaped
        case "&": // & operator is an alternative unescape method
          return that.find(name, context);
        default: // escape the value
          return escapeHTML(that.find(name, context));
        }
      };
      var lines = template.split("\n");
      for(var i = 0; i < lines.length; i++) {
        lines[i] = lines[i].replace(regex, tag_replace_callback, this);
        if (!in_recursion) {
          this.send(lines[i]);
        }
      }

      if (in_recursion) {
        return lines.join("\n");
      }
    },

    set_delimiters: function (delimiters) {
      var dels = delimiters.split(" ");
      this.otag = this.escape_regex(dels[0]);
      this.ctag = this.escape_regex(dels[1]);
    },

    escape_regex: function (text) {
      // thank you Simon Willison
      if (!arguments.callee.sRE) {
        var specials = [
          '/', '.', '*', '+', '?', '|',
          '(', ')', '[', ']', '{', '}', '\\'
        ];
        arguments.callee.sRE = new RegExp(
          '(\\' + specials.join('|\\') + ')', 'g'
        );
      }
      return text.replace(arguments.callee.sRE, '\\$1');
    },

    /*
      find `name` in current `context`. That is find me a value
      from the view object
    */
    find: function (name, context) {
      name = trim(name);

      // Checks whether a value is thruthy or false or 0
      function is_kinda_truthy(bool) {
        return bool === false || bool === 0 || bool;
      }

      var value;

      // check for dot notation eg. foo.bar
      if (name.match(/([a-z_]+)\./ig)) {
        var childValue = this.walk_context(name, context);
        if (is_kinda_truthy(childValue)) {
          value = childValue;
        }
      } else {
        if (is_kinda_truthy(context[name])) {
          value = context[name];
        } else if (is_kinda_truthy(this.context[name])) {
          value = this.context[name];
        }
      }

      if (typeof value == "function") {
        return value.apply(context);
      }
      if (value !== undefined) {
        return value;
      }
      // silently ignore unkown variables
      return "";
    },

    walk_context: function (name, context) {
      var path = name.split('.');
      // if the var doesn't exist in current context, check the top level context
      var value_context = (context[path[0]] != undefined) ? context : this.context;
      var value = value_context[path.shift()];
      while (value != undefined && path.length > 0) {
        value_context = value;
        value = value[path.shift()];
      }
      // if the value is a function, call it, binding the correct context
      if (typeof value == "function") {
        return value.apply(value_context);
      }
      return value;
    },

    // Utility methods

    /* includes tag */
    includes: function (needle, haystack) {
      return haystack.indexOf(this.otag + needle) != -1;
    },

    // by @langalex, support for arrays of strings
    create_context: function (_context) {
      if (this.is_object(_context)) {
        return _context;
      } else {
        var iterator = ".";
        if (this.pragmas["IMPLICIT-ITERATOR"]) {
          iterator = this.pragmas["IMPLICIT-ITERATOR"].iterator;
        }
        var ctx = {};
        ctx[iterator] = _context;
        return ctx;
      }
    },

    is_object: function (a) {
      return a && typeof a == "object";
    },

    /*
      Why, why, why? Because IE. Cry, cry cry.
    */
    map: function (array, fn) {
      if (typeof array.map == "function") {
        return array.map(fn);
      } else {
        var r = [];
        var l = array.length;
        for(var i = 0; i < l; i++) {
          r.push(fn(array[i]));
        }
        return r;
      }
    },

    getCachedRegex: function (name, generator) {
      var byOtag = regexCache[this.otag];
      if (!byOtag) {
        byOtag = regexCache[this.otag] = {};
      }

      var byCtag = byOtag[this.ctag];
      if (!byCtag) {
        byCtag = byOtag[this.ctag] = {};
      }

      var regex = byCtag[name];
      if (!regex) {
        regex = byCtag[name] = generator(this.otag, this.ctag);
      }

      return regex;
    }
  };

  return({
    name: "mustache.js",
    version: "0.5.0-dev",

    /*
      Turns a template and view into HTML
    */
    to_html: function (template, view, partials, send_fun) {
      var renderer = new Renderer();
      if (send_fun) {
        renderer.send = send_fun;
      }
      renderer.render(template, view || {}, partials);
      if (!send_fun) {
        return renderer.buffer.join("\n");
      }
    }
  });
}();
// Underscore.js 1.2.3
// (c) 2009-2011 Jeremy Ashkenas, DocumentCloud Inc.
// Underscore is freely distributable under the MIT license.
// Portions of Underscore are inspired or borrowed from Prototype,
// Oliver Steele's Functional, and John Resig's Micro-Templating.
// For all details and documentation:
// http://documentcloud.github.com/underscore
(function(){function r(a,c,d){if(a===c)return a!==0||1/a==1/c;if(a==null||c==null)return a===c;if(a._chain)a=a._wrapped;if(c._chain)c=c._wrapped;if(a.isEqual&&b.isFunction(a.isEqual))return a.isEqual(c);if(c.isEqual&&b.isFunction(c.isEqual))return c.isEqual(a);var e=l.call(a);if(e!=l.call(c))return false;switch(e){case "[object String]":return a==String(c);case "[object Number]":return a!=+a?c!=+c:a==0?1/a==1/c:a==+c;case "[object Date]":case "[object Boolean]":return+a==+c;case "[object RegExp]":return a.source==
c.source&&a.global==c.global&&a.multiline==c.multiline&&a.ignoreCase==c.ignoreCase}if(typeof a!="object"||typeof c!="object")return false;for(var f=d.length;f--;)if(d[f]==a)return true;d.push(a);var f=0,g=true;if(e=="[object Array]"){if(f=a.length,g=f==c.length)for(;f--;)if(!(g=f in a==f in c&&r(a[f],c[f],d)))break}else{if("constructor"in a!="constructor"in c||a.constructor!=c.constructor)return false;for(var h in a)if(m.call(a,h)&&(f++,!(g=m.call(c,h)&&r(a[h],c[h],d))))break;if(g){for(h in c)if(m.call(c,
h)&&!f--)break;g=!f}}d.pop();return g}var s=this,F=s._,o={},k=Array.prototype,p=Object.prototype,i=k.slice,G=k.concat,H=k.unshift,l=p.toString,m=p.hasOwnProperty,v=k.forEach,w=k.map,x=k.reduce,y=k.reduceRight,z=k.filter,A=k.every,B=k.some,q=k.indexOf,C=k.lastIndexOf,p=Array.isArray,I=Object.keys,t=Function.prototype.bind,b=function(a){return new n(a)};if(typeof exports!=="undefined"){if(typeof module!=="undefined"&&module.exports)exports=module.exports=b;exports._=b}else typeof define==="function"&&
define.amd?define("underscore",function(){return b}):s._=b;b.VERSION="1.2.3";var j=b.each=b.forEach=function(a,c,b){if(a!=null)if(v&&a.forEach===v)a.forEach(c,b);else if(a.length===+a.length)for(var e=0,f=a.length;e<f;e++){if(e in a&&c.call(b,a[e],e,a)===o)break}else for(e in a)if(m.call(a,e)&&c.call(b,a[e],e,a)===o)break};b.map=function(a,c,b){var e=[];if(a==null)return e;if(w&&a.map===w)return a.map(c,b);j(a,function(a,g,h){e[e.length]=c.call(b,a,g,h)});return e};b.reduce=b.foldl=b.inject=function(a,
c,d,e){var f=arguments.length>2;a==null&&(a=[]);if(x&&a.reduce===x)return e&&(c=b.bind(c,e)),f?a.reduce(c,d):a.reduce(c);j(a,function(a,b,i){f?d=c.call(e,d,a,b,i):(d=a,f=true)});if(!f)throw new TypeError("Reduce of empty array with no initial value");return d};b.reduceRight=b.foldr=function(a,c,d,e){var f=arguments.length>2;a==null&&(a=[]);if(y&&a.reduceRight===y)return e&&(c=b.bind(c,e)),f?a.reduceRight(c,d):a.reduceRight(c);var g=b.toArray(a).reverse();e&&!f&&(c=b.bind(c,e));return f?b.reduce(g,
c,d,e):b.reduce(g,c)};b.find=b.detect=function(a,c,b){var e;D(a,function(a,g,h){if(c.call(b,a,g,h))return e=a,true});return e};b.filter=b.select=function(a,c,b){var e=[];if(a==null)return e;if(z&&a.filter===z)return a.filter(c,b);j(a,function(a,g,h){c.call(b,a,g,h)&&(e[e.length]=a)});return e};b.reject=function(a,c,b){var e=[];if(a==null)return e;j(a,function(a,g,h){c.call(b,a,g,h)||(e[e.length]=a)});return e};b.every=b.all=function(a,c,b){var e=true;if(a==null)return e;if(A&&a.every===A)return a.every(c,
b);j(a,function(a,g,h){if(!(e=e&&c.call(b,a,g,h)))return o});return e};var D=b.some=b.any=function(a,c,d){c||(c=b.identity);var e=false;if(a==null)return e;if(B&&a.some===B)return a.some(c,d);j(a,function(a,b,h){if(e||(e=c.call(d,a,b,h)))return o});return!!e};b.include=b.contains=function(a,c){var b=false;if(a==null)return b;return q&&a.indexOf===q?a.indexOf(c)!=-1:b=D(a,function(a){return a===c})};b.invoke=function(a,c){var d=i.call(arguments,2);return b.map(a,function(a){return(c.call?c||a:a[c]).apply(a,
d)})};b.pluck=function(a,c){return b.map(a,function(a){return a[c]})};b.max=function(a,c,d){if(!c&&b.isArray(a))return Math.max.apply(Math,a);if(!c&&b.isEmpty(a))return-Infinity;var e={computed:-Infinity};j(a,function(a,b,h){b=c?c.call(d,a,b,h):a;b>=e.computed&&(e={value:a,computed:b})});return e.value};b.min=function(a,c,d){if(!c&&b.isArray(a))return Math.min.apply(Math,a);if(!c&&b.isEmpty(a))return Infinity;var e={computed:Infinity};j(a,function(a,b,h){b=c?c.call(d,a,b,h):a;b<e.computed&&(e={value:a,
computed:b})});return e.value};b.shuffle=function(a){var c=[],b;j(a,function(a,f){f==0?c[0]=a:(b=Math.floor(Math.random()*(f+1)),c[f]=c[b],c[b]=a)});return c};b.sortBy=function(a,c,d){return b.pluck(b.map(a,function(a,b,g){return{value:a,criteria:c.call(d,a,b,g)}}).sort(function(a,c){var b=a.criteria,d=c.criteria;return b<d?-1:b>d?1:0}),"value")};b.groupBy=function(a,c){var d={},e=b.isFunction(c)?c:function(a){return a[c]};j(a,function(a,b){var c=e(a,b);(d[c]||(d[c]=[])).push(a)});return d};b.sortedIndex=
function(a,c,d){d||(d=b.identity);for(var e=0,f=a.length;e<f;){var g=e+f>>1;d(a[g])<d(c)?e=g+1:f=g}return e};b.toArray=function(a){return!a?[]:a.toArray?a.toArray():b.isArray(a)?i.call(a):b.isArguments(a)?i.call(a):b.values(a)};b.size=function(a){return b.toArray(a).length};b.first=b.head=function(a,b,d){return b!=null&&!d?i.call(a,0,b):a[0]};b.initial=function(a,b,d){return i.call(a,0,a.length-(b==null||d?1:b))};b.last=function(a,b,d){return b!=null&&!d?i.call(a,Math.max(a.length-b,0)):a[a.length-
1]};b.rest=b.tail=function(a,b,d){return i.call(a,b==null||d?1:b)};b.compact=function(a){return b.filter(a,function(a){return!!a})};b.flatten=function(a,c){return b.reduce(a,function(a,e){if(b.isArray(e))return a.concat(c?e:b.flatten(e));a[a.length]=e;return a},[])};b.without=function(a){return b.difference(a,i.call(arguments,1))};b.uniq=b.unique=function(a,c,d){var d=d?b.map(a,d):a,e=[];b.reduce(d,function(d,g,h){if(0==h||(c===true?b.last(d)!=g:!b.include(d,g)))d[d.length]=g,e[e.length]=a[h];return d},
[]);return e};b.union=function(){return b.uniq(b.flatten(arguments,true))};b.intersection=b.intersect=function(a){var c=i.call(arguments,1);return b.filter(b.uniq(a),function(a){return b.every(c,function(c){return b.indexOf(c,a)>=0})})};b.difference=function(a){var c=b.flatten(i.call(arguments,1));return b.filter(a,function(a){return!b.include(c,a)})};b.zip=function(){for(var a=i.call(arguments),c=b.max(b.pluck(a,"length")),d=Array(c),e=0;e<c;e++)d[e]=b.pluck(a,""+e);return d};b.indexOf=function(a,
c,d){if(a==null)return-1;var e;if(d)return d=b.sortedIndex(a,c),a[d]===c?d:-1;if(q&&a.indexOf===q)return a.indexOf(c);for(d=0,e=a.length;d<e;d++)if(d in a&&a[d]===c)return d;return-1};b.lastIndexOf=function(a,b){if(a==null)return-1;if(C&&a.lastIndexOf===C)return a.lastIndexOf(b);for(var d=a.length;d--;)if(d in a&&a[d]===b)return d;return-1};b.range=function(a,b,d){arguments.length<=1&&(b=a||0,a=0);for(var d=arguments[2]||1,e=Math.max(Math.ceil((b-a)/d),0),f=0,g=Array(e);f<e;)g[f++]=a,a+=d;return g};
var E=function(){};b.bind=function(a,c){var d,e;if(a.bind===t&&t)return t.apply(a,i.call(arguments,1));if(!b.isFunction(a))throw new TypeError;e=i.call(arguments,2);return d=function(){if(!(this instanceof d))return a.apply(c,e.concat(i.call(arguments)));E.prototype=a.prototype;var b=new E,g=a.apply(b,e.concat(i.call(arguments)));return Object(g)===g?g:b}};b.bindAll=function(a){var c=i.call(arguments,1);c.length==0&&(c=b.functions(a));j(c,function(c){a[c]=b.bind(a[c],a)});return a};b.memoize=function(a,
c){var d={};c||(c=b.identity);return function(){var b=c.apply(this,arguments);return m.call(d,b)?d[b]:d[b]=a.apply(this,arguments)}};b.delay=function(a,b){var d=i.call(arguments,2);return setTimeout(function(){return a.apply(a,d)},b)};b.defer=function(a){return b.delay.apply(b,[a,1].concat(i.call(arguments,1)))};b.throttle=function(a,c){var d,e,f,g,h,i=b.debounce(function(){h=g=false},c);return function(){d=this;e=arguments;var b;f||(f=setTimeout(function(){f=null;h&&a.apply(d,e);i()},c));g?h=true:
a.apply(d,e);i();g=true}};b.debounce=function(a,b){var d;return function(){var e=this,f=arguments;clearTimeout(d);d=setTimeout(function(){d=null;a.apply(e,f)},b)}};b.once=function(a){var b=false,d;return function(){if(b)return d;b=true;return d=a.apply(this,arguments)}};b.wrap=function(a,b){return function(){var d=G.apply([a],arguments);return b.apply(this,d)}};b.compose=function(){var a=arguments;return function(){for(var b=arguments,d=a.length-1;d>=0;d--)b=[a[d].apply(this,b)];return b[0]}};b.after=
function(a,b){return a<=0?b():function(){if(--a<1)return b.apply(this,arguments)}};b.keys=I||function(a){if(a!==Object(a))throw new TypeError("Invalid object");var b=[],d;for(d in a)m.call(a,d)&&(b[b.length]=d);return b};b.values=function(a){return b.map(a,b.identity)};b.functions=b.methods=function(a){var c=[],d;for(d in a)b.isFunction(a[d])&&c.push(d);return c.sort()};b.extend=function(a){j(i.call(arguments,1),function(b){for(var d in b)b[d]!==void 0&&(a[d]=b[d])});return a};b.defaults=function(a){j(i.call(arguments,
1),function(b){for(var d in b)a[d]==null&&(a[d]=b[d])});return a};b.clone=function(a){return!b.isObject(a)?a:b.isArray(a)?a.slice():b.extend({},a)};b.tap=function(a,b){b(a);return a};b.isEqual=function(a,b){return r(a,b,[])};b.isEmpty=function(a){if(b.isArray(a)||b.isString(a))return a.length===0;for(var c in a)if(m.call(a,c))return false;return true};b.isElement=function(a){return!!(a&&a.nodeType==1)};b.isArray=p||function(a){return l.call(a)=="[object Array]"};b.isObject=function(a){return a===
Object(a)};b.isArguments=function(a){return l.call(a)=="[object Arguments]"};if(!b.isArguments(arguments))b.isArguments=function(a){return!(!a||!m.call(a,"callee"))};b.isFunction=function(a){return l.call(a)=="[object Function]"};b.isString=function(a){return l.call(a)=="[object String]"};b.isNumber=function(a){return l.call(a)=="[object Number]"};b.isNaN=function(a){return a!==a};b.isBoolean=function(a){return a===true||a===false||l.call(a)=="[object Boolean]"};b.isDate=function(a){return l.call(a)==
"[object Date]"};b.isRegExp=function(a){return l.call(a)=="[object RegExp]"};b.isNull=function(a){return a===null};b.isUndefined=function(a){return a===void 0};b.noConflict=function(){s._=F;return this};b.identity=function(a){return a};b.times=function(a,b,d){for(var e=0;e<a;e++)b.call(d,e)};b.escape=function(a){return(""+a).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;").replace(/\//g,"&#x2F;")};b.mixin=function(a){j(b.functions(a),function(c){J(c,
b[c]=a[c])})};var K=0;b.uniqueId=function(a){var b=K++;return a?a+b:b};b.templateSettings={evaluate:/<%([\s\S]+?)%>/g,interpolate:/<%=([\s\S]+?)%>/g,escape:/<%-([\s\S]+?)%>/g};b.template=function(a,c){var d=b.templateSettings,d="var __p=[],print=function(){__p.push.apply(__p,arguments);};with(obj||{}){__p.push('"+a.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(d.escape,function(a,b){return"',_.escape("+b.replace(/\\'/g,"'")+"),'"}).replace(d.interpolate,function(a,b){return"',"+b.replace(/\\'/g,
"'")+",'"}).replace(d.evaluate||null,function(a,b){return"');"+b.replace(/\\'/g,"'").replace(/[\r\n\t]/g," ")+";__p.push('"}).replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t")+"');}return __p.join('');",e=new Function("obj","_",d);return c?e(c,b):function(a){return e.call(this,a,b)}};var n=function(a){this._wrapped=a};b.prototype=n.prototype;var u=function(a,c){return c?b(a).chain():a},J=function(a,c){n.prototype[a]=function(){var a=i.call(arguments);H.call(a,this._wrapped);return u(c.apply(b,
a),this._chain)}};b.mixin(b);j("pop,push,reverse,shift,sort,splice,unshift".split(","),function(a){var b=k[a];n.prototype[a]=function(){b.apply(this._wrapped,arguments);return u(this._wrapped,this._chain)}});j(["concat","join","slice"],function(a){var b=k[a];n.prototype[a]=function(){return u(b.apply(this._wrapped,arguments),this._chain)}});n.prototype.chain=function(){this._chain=true;return this};n.prototype.value=function(){return this._wrapped}}).call(this);
/* main file */


if ( window.IriSP === undefined && window.__IriSP === undefined ) { 
  /**
    @class
    the object under which everything goes.        
  */
	IriSP = {}; 
  
  /** Alias to IriSP for backward compatibility */
	__IriSP = IriSP;
}

/* underscore comes bundled with the player and we need 
   it ASAP, so load it that way
*/

IriSP._ = window._.noConflict();
IriSP.underscore = IriSP._;

IriSP.loadLibs = function( libs, config, metadata_url, callback ) {
    // Localize jQuery variable
		IriSP.jQuery = null;
    var $L = $LAB.script(libs.jQuery).script(libs.swfObject).wait()
                .script(libs.jQueryUI);
                                   
    if (config.player.type === "jwplayer") {
      // load our popcorn.js lookalike
      $L = $L.script(libs.jwplayer);
    } else {
      // load the real popcorn
      $L = $L.script(libs.popcorn).script(libs["popcorn.code"]);
      if (config.player.type === "youtube") {
        $L = $L.script(libs["popcorn.youtube"]);
      } 
      if (config.player.type === "vimeo")
        $L = $L.script(libs["popcorn.vimeo"]);
      
      /* do nothing for html5 */
    }       
    
    /* widget specific requirements */
    for (var idx in config.gui.widgets) {
      if (config.gui.widgets[idx].type === "PolemicWidget" ||
          config.gui.widgets[idx].type === "StackGraphWidget") {        
        $L.script(libs.raphael);
      }

      if (config.gui.widgets[idx].type === "SparklineWidget") {
        $L.script(libs.jquery_sparkline);
      }
    }
    
    // same for modules
    /*
    for (var idx in config.modules) {
      if (config.modules[idx].type === "PolemicWidget")
        $L.script(libs.raphaelJs);
    }
    */

    $L.wait(function() {
      IriSP.jQuery = window.jQuery.noConflict( true );
      
      var css_link_jquery = IriSP.jQuery( "<link>", { 
        rel: "stylesheet", 
        type: "text/css", 
        href: libs.cssjQueryUI,
        'class': "dynamic_css"
      } );
      var css_link_custom = IriSP.jQuery( "<link>", { 
        rel: "stylesheet", 
        type: "text/css", 
        href: config.gui.css,
        'class': "dynamic_css"
      } );
      
      css_link_jquery.appendTo('head');
      css_link_custom.appendTo('head');
          
      IriSP.setupDataLoader();
      IriSP.__dataloader.get(metadata_url, 
          function(data) {
            /* save the data so that we could re-use it to
               configure the video
            */
            IriSP.__jsonMetadata = data;
            callback.call(window) });
    });
};
IriSP.SparklineWidget_template = "<div class='Ldt-sparklineWidget' style='width: {{width}}px; height: {{height}}px'>    <div class='Ldt-sparkLinePositionMarker' style='width: 0px; height: {{height}}px'></div>    <div class='Ldt-sparkLineClickOverlay' style='width: {{width}}px; height: {{height}}px'></div>    <div class='Ldt-sparkLine' style='width: {{width}}px; height: {{height}}px'>Loading</div></div>";
IriSP.annotation_template = "{{! template for an annotation displayed in a segmentWidget }}<div title='{{divTitle}}' id='{{id}}'	class='Ldt-iri-chapter' 	style='left: {{startPixel}}px;          width: {{pxWidth}}px;          background-color:#{{hexa_color}};' 	></div>";
IriSP.annotationWidget_template = "{{! template for the annotation widget }}<div class='Ldt-AnnotationsWidget'>  <!-- ugly div because we want to have a double border -->  <div class='Ldt-Annotation-DoubleBorder'>      <div class='Ldt-AnnotationContent'>          <div class='Ldt-AnnotationShareIcons'>         <a target='_blank' class='Ldt-fbShare' title='share on facebook'></a>         <a target='_blank' class='Ldt-TwShare' title='share on twitter'></a>         <a target='_blank'  class='Ldt-GplusShare' title='share on google+'></a>        </div>        <div class='Ldt-SaTitle'></div>        <div class='Ldt-SaDescription'></div>        <div class='Ldt-SaKeywords'></div>    </div>  </div></div>";
IriSP.annotation_loading_template = "{{! template shown while the annotation widget is loading }}<div id='Ldt-load-container'><div id='Ldt-loader'>&nbsp;</div> Chargement... </div>";
IriSP.annotationsListWidget_template = "{{! template for the annotation list widget }}<div class='Ldt-AnnotationsListWidget'>  <!-- ugly div because we want to have a double border -->  <div class='Ldt-Annotation-DoubleBorder'>    <ul>    {{#annotations}}      <li>        {{! if the url is not present, it means that the annotation exists             in the current project }}        {{^url}}        <a href='#id={{id}}'>        {{/url}}        {{! otherwise link to url }}        {{#url}}        <a href='{{url}}#id={{id}}'>        {{/url}}          <div style='overflow: auto; margin-top: 5px; margin-bottom: 5px;'>            <div class='Ldt-AnnotationsList-Caption'>              <img src='{{img_dir}}/video_sequence.png'></img>            </div>            <div class='Ldt-AnnotationsList-Duration'>{{begin}} - {{end}}</div>            <div class='Ldt-AnnotationsList-Title'>{{title}}</div>            <div class='Ldt-AnnotationsList-Description'>{{desc}}</div>          </div>        </a>      </li>    {{/annotations}}    </ul>  </div></div>";
IriSP.arrowWidget_template = "<div class='Ldt-arrowWidget'></div>";
IriSP.createAnnotationWidget_template = "{{! template for the annotation creation widget }}<div class='Ldt-createAnnotationWidget'>  <!-- ugly div because we want to have a double border -->  <div class='Ldt-createAnnotation-DoubleBorder'>    <div class='Ldt-createAnnotation-startScreen'>      <div style='margin-bottom: 7px; overflow: auto;'>        <div class='Ldt-createAnnotation-Title'></div>        <div class='Ldt-createAnnotation-TimeFrame'></div>        {{^cinecast_version}}          <div class='Ldt-createAnnotation-Minimize' title='Cancel'></div>        {{/cinecast_version}}      </div>            <div class='Ldt-createAnnotation-Container'>        <textarea class='Ldt-createAnnotation-Description'></textarea>        <div class='Ldt-createAnnotation-profileArrow'>                  </div>        <div class='Ldt-createAnnotation-userAvatar'>        {{^user_avatar}}          <img src='https://si0.twimg.com/sticky/default_profile_images/default_profile_1_normal.png'></img>        {{/user_avatar}}        {{#user_avatar}}          <img src='{{ user_avatar }}'></img>        {{/user_avatar}}        </div>      </div>      <div class='Ldt-createAnnotation-submitButton'>        <div style='position: absolute; bottom: 5px; right: 5px;'>Submit</div>      </div>      <div class='Ldt-createAnnotation-keywords'>        Add keywords :             </div>      {{#polemic_mode}}      <div class='Ldt-createAnnotation-polemics'>        Add polemic keywords           </div>      {{/polemic_mode}}    </div>    <div class='Ldt-createAnnotation-waitScreen' style='display: none; text-align: center'>      <img src='{{img_dir}}/spinner.gif'></img>      Please wait while your request is being processed...    </div>    <div class='Ldt-createAnnotation-errorScreen' style='display: none; text-align: center'>      <div class='Ldt-createAnnotation-Minimize' title='Hide'></div>      An error happened while contacting the server. Your annotation has not been saved.    </div>        <div class='Ldt-createAnnotation-endScreen' style='display: none'>      <div class='Ldt-createAnnotation-Minimize' title='Hide'></div>      Thank you, your annotation has been saved.<br>      Would you like to share it on social networks ?      <div style='margin-top: 12px; text-align: center;'>          <a target='_blank' class='Ldt-createAnnotation-endScreen-TweetLink'><img src='{{img_dir}}/tweet_button.png' style='margin-right: 20px;'></img></a>          <a target='_blank' class='Ldt-createAnnotation-endScreen-FbLink'><img src='{{img_dir}}/facebook_button.png' style='margin-right: 20px;'></img></a>          <a target='_blank' class='Ldt-createAnnotation-endScreen-GplusLink'><img src='{{img_dir}}/gplus_button.png' style='margin-right: 20px;'></img></a>                          </div>    </div>  </div></div>";
IriSP.createAnnotationWidget_festivalCinecast_template = "{{! template for the annotation creation widget specific for the cinecast festival}}<div class='Ldt-createAnnotationWidget'>  <!-- ugly div because we want to have a double border -->  <div class='Ldt-createAnnotation-DoubleBorder'>    <div style='margin-bottom: 7px; overflow: auto;'>      <div class='Ldt-createAnnotation-Title'></div>      <div class='Ldt-createAnnotation-TimeFrame'></div>    </div>        <div class='Ldt-createAnnotation-Container'>      <textarea class='Ldt-createAnnotation-Description'></textarea>      <div class='Ldt-createAnnotation-profileArrow'>        <img src='{{img_dir}}/annotate_arrow.png'></img>      </div>      <div class='Ldt-createAnnotation-userAvatar'>                <img src='https://si0.twimg.com/sticky/default_profile_images/default_profile_1_normal.png'></img>      </div>    </div>        <div class='Ldt-createAnnotation-keywords'>      Add keywords :           </div>              <div class='Ldt-createAnnotation-submitButton'>      <div style='position: absolute; bottom: 10pt; right: 11pt;'>Submit</div>    </div>        <div class='Ldt-createAnnotation-endScreen' style='display: none'>      Thank you, your annotation has been saved.<br>      Would you like to share it on social networks ?      <div style='margin-top: 12px; text-align: center;'>          <a target='_blank' class='Ldt-createAnnotation-endScreen-TweetLink'><img src='{{img_dir}}/tweet_button.png' style='margin-right: 20px;'></img></a>          <a target='_blank' class='Ldt-createAnnotation-endScreen-FbLink'><img src='{{img_dir}}/facebook_button.png' style='margin-right: 20px;'></img></a>          <a target='_blank' class='Ldt-createAnnotation-endScreen-GplusLink'><img src='{{img_dir}}/gplus_button.png' style='margin-right: 20px;'></img></a>                          </div>    </div>  </div></div>";
IriSP.createAnnotation_errorMessage_template = "<p class='Ldt-createAnnotation-errorMessage'>  You must enter text to submit an annotation</p>";
IriSP.overlay_marker_template = "{{! the template for the small bars which is z-indexed over our segment widget }}<div class='Ldt-SegmentPositionMarker' style='background-color: #F7268E;'></div>";
IriSP.player_template = "{{! template for the radio player }}<div class='Ldt-controler demo'>	<div class='Ldt-LeftPlayerControls'>    <div class='Ldt-button Ldt-CtrlPlay' title='Play/Pause'></div>		<div class='Ldt-button Ldt-CtrlAnnotate' title='Annotate'></div>    <div class='Ldt-button Ldt-CtrlSearch' title='Search'></div>    <div class='LdtSearch'>      <input class='LdtSearchInput' style='margin-top: 2px; margin-bottom: 2px;'></input>    </div>    	</div>	<div class='Ldt-RightPlayerControls'>    <div class='Ldt-Time'>      <div class='Ldt-ElapsedTime' title='Elapsed time'>00:00</div>      <div class='Ldt-TimeSeparator'>/</div>      <div class='Ldt-TotalTime' title='Total time'>00:00</div>    </div>		<div class='Ldt-button Ldt-CtrlSound' title='Mute/Unmute'></div>	</div></div>";
IriSP.search_template = "{{! template for the search container }}<div class='LdtSearchContainer'	style='margin-left: {{margin_left}}; position: absolute; margin-top: -60px;'>	<div class='LdtSearch'		style='display: none; background-color: #EEE; width: 165px; border-color: #CFCFCF; position: absolute; text-align: center;'>		<input class='LdtSearchInput'			style='margin-top: 1px; margin-bottom: 2px;' />	</div></div><div class='cleaner'></div>";
IriSP.share_template = "{{! social network sharing template }}<a onclick='__IriSP.MyApiPlayer.share(\'delicious\');' title='partager avec delicious'><span class='share shareDelicious'>&nbsp;</span></a>		<a onclick='__IriSP.MyApiPlayer.share(\'facebook\');' title='partager avec facebook'> <span class='share shareFacebook'>&nbsp;</span></a><a onclick='__IriSP.MyApiPlayer.share(\'twitter\');' title='partager avec twitter'>  <span class='share shareTwitter'>&nbsp;</span></a><a onclick='__IriSP.MyApiPlayer.share(\'myspace\');' title='partager avec Myspace'>  <span class='share shareMySpace'>&nbsp;</span></a>";
IriSP.sliceWidget_template = "{{! template for the slice widget }}<div class='Ldt-sliceWidget'>  {{! the whole bar }}  <div class='Ldt-sliceBackground'></div>    <div class='Ldt-sliceLeftHandle'></div>  {{! the zone which represents our slice }}  <div class='Ldt-sliceZone'></div>     <div class='Ldt-sliceRightHandle'></div></div>";
IriSP.sliderWidget_template = "{{! template for the slider widget - it's composed of two divs we one overlayed on top    of the other }}<div class='Ldt-sliderBackground'></div><div class='Ldt-sliderForeground'></div><div class='Ldt-sliderPositionMarker'></div>";
IriSP.tooltip_template = "{{! template used by the jquery ui tooltip }}<div class='Ldt-tooltip'>  <div class='title'>{{title}}</div>  <div class='time'>{{begin}} : {{end}} </div>  <div class='description'>{{description}}</div></div>";
IriSP.tooltipWidget_template = "{{! template for the tooltip widget }}<div class='tip'>	<div class='tipcolor' style='height:10px;width:10px'></div>	<div class='tiptext'></div>";
IriSP.tweetWidget_template = "{{! template for the tweet widget }}<div class='Ldt-tweetWidget'>  <div class='Ldt-tweet-DoubleBorder'>      <div class='Ldt-tweetWidgetKeepOpen' title='dont minimize automatically'></div>      <div class='Ldt-tweetWidgetMinimize' title='minimize window'></div>      <div class='Ldt-tweetAvatar'></div>      <div class='Ldt-tweetAvatar-profileArrow'></div>      <div class='Ldt-tweetContents'></div>      <a href='' target='_blank' class='Ldt-Retweet'><div class='Ldt-RetweetIcon'></div> - Retweet </a>      <a href='' target='_blank' class='Ldt-TweetReply'><div class='Ldt-TweetReplyIcon'></div> - Reply</a>  </div></div>";/* utils.js - various utils that don't belong anywhere else */

/* trace function, for debugging */

IriSP.traceNum = 0;
IriSP.trace = function( msg, value ) {
/*
	if( IriSP.config.gui.debug === true ) {
		IriSP.traceNum += 1;
		IriSP.jQuery( "<div>"+IriSP.traceNum+" - "+msg+" : "+value+"</div>" ).appendTo( "#Ldt-output" );
	}
*/
};

/* used in callbacks - because in callbacks we lose "this",
   we need to have a special function which wraps "this" in 
   a closure. This way, the 
*/   
IriSP.wrap = function (obj, fn) {
  return function() {    
    var args = Array.prototype.slice.call(arguments, 0);
    return fn.apply(obj, args);
  }
}

/* convert a time to a percentage in the media */
IriSP.timeToPourcent = function(time, timetotal){
	var time = Math.abs(time);
  var timetotal = Math.abs(timetotal);
  
	return Math.floor((time/timetotal) * 100);
};

IriSP.padWithZeros = function(num) {
  if (Math.abs(num) < 10) {
    return "0" + num.toString();
  } else {
    return num.toString();
  }
};

/* convert a number of milliseconds to a tuple of the form 
   [hours, minutes, seconds]
*/
IriSP.msToTime = function(ms) {
  return IriSP.secondsToTime(ms / 1000);
}
/* convert a number of seconds to a tuple of the form 
   [hours, minutes, seconds]
*/
IriSP.secondsToTime = function(secs) {  
  var hours = Math.abs(parseInt( secs / 3600 ) % 24);
  var minutes = Math.abs(parseInt( secs / 60 ) % 60);
  var seconds = parseFloat(Math.abs(secs % 60).toFixed(0));
  
  var toString_fn = function() {
    var ret = "";
    if (hours > 0)
       ret = IriSP.padWithZeros(this.hours) + ":";
    ret += IriSP.padWithZeros(this.minutes) + ":" + IriSP.padWithZeros(this.seconds);

    return ret;
  }
  return {"hours" : hours, "minutes" : minutes, "seconds" : seconds, toString: toString_fn};
};

/* format a tweet - replaces @name by a link to the profile, #hashtag, etc. */
IriSP.formatTweet = function(tweet) {
  /*
    an array of arrays which hold a regexp and its replacement.
  */
  var regExps = [
    /* copied from http://codegolf.stackexchange.com/questions/464/shortest-url-regex-match-in-javascript/480#480 */
    [/((https?:\/\/)?[\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?)/gi, "<a href='$1'>$1</a>"],
    [/@(\w+)/gi, "<a href='http://twitter.com/$1'>@$1</a>"], // matches a @handle
    [/#(\w+)/gi, "<a href='http://twitter.com/search?q=%23$1'>#$1</a>"],// matches a hashtag
    [/(\+\+)/gi, "<span class='Ldt-PolemicPlusPlus'>$1</span>"],
    [/(--)/gi, "<span class='Ldt-PolemicMinusMinus'>$1</span>"],
    [/(==)/gi, "<span class='Ldt-PolemicEqualEqual'>$1</span>"],
    [/(\?\?)/gi, "<span class='Ldt-PolemicQuestion'>$1</span>"]
  ]; 

  var i = 0;
  for(i = 0; i < regExps.length; i++) {
     tweet = tweet.replace(regExps[i][0], regExps[i][1]);
  }
  
  return tweet;
};

IriSP.countProperties = function(obj) {
    var count = 0;

    for(var prop in obj) {
        if(obj.hasOwnProperty(prop))
                ++count;
    }

    return count;
};

// conversion de couleur Decimal vers HexaDecimal || 000 si fff
IriSP.DEC_HEXA_COLOR = function (dec) {
  var val = +dec;
  var str = val.toString(16);
  var zeroes = "";
  if (str.length < 6) {
    for (var i = 0; i < 6 - str.length; i++)
      zeroes += "0";
  }
  return zeroes + str;
};

/* shortcut to have global variables in templates */
IriSP.templToHTML = function(template, values) {
  var params = IriSP.jQuery.extend(IriSP.default_templates_vars, values);
  return Mustache.to_html(template, params);
};

/* we need to be stricter than encodeURIComponent,
   because of twitter
*/  
IriSP.encodeURI = function(str) {
  return encodeURIComponent(str).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').  
                                 replace(/\)/g, '%29').replace(/\*/g, '%2A');  
}  

IriSP.__guidCounter = 0;
IriSP.guid = function(prefix) {
  IriSP.__guidCounter += 1;
  return prefix + IriSP.__guidCounter;
};

/** returns an url to share on facebook */
IriSP.mkFbUrl = function(url, text) {
  if (typeof(text) === "undefined")
    text = "I'm watching ";
  
  return "http://www.facebook.com/share.php?u=" + IriSP.encodeURI(text) + IriSP.shorten_url(url);
};

/** returns an url to share on twitter */
IriSP.mkTweetUrl = function(url, text) {
  if (typeof(text) === "undefined")
    text = "I'm watching ";
  
  return "http://twitter.com/home?status=" + IriSP.encodeURI(text) + IriSP.shorten_url(url);
};

/** returns an url to share on google + */
IriSP.mkGplusUrl = function(url, text) {
  return "https://plusone.google.com/_/+1/confirm?hl=en&url=" + IriSP.shorten_url(url);
};

/** test if a value is null or undefined */
IriSP.null_or_undefined = function(val) {
  return (typeof(val) === "undefined" || val === null);
};

/** issue a call to an url shortener and return the shortened url */
IriSP.shorten_url = function(url) {
  if (IriSP.config.shortener.hasOwnProperty("shortening_function"))
    return IriSP.config.shortener.shortening_function(url);
    
  return url;
};

/** Similar to substr but remove the last word if
    we're breaking a word in two.
 */ 
IriSP.clean_substr = function(str, start, end) {
  var s = str.substr(start, end).substr(start, end).split(" ");
  s.pop();
  return s.join(" ");
};
/* for ie compatibility
if (Object.prototype.__defineGetter__&&!Object.defineProperty) {
   Object.defineProperty=function(obj,prop,desc) {
      if ("get" in desc) obj.__defineGetter__(prop,desc.get);
      if ("set" in desc) obj.__defineSetter__(prop,desc.set);
   }
}
*/
/* wrapper that simulates popcorn.js because
   popcorn is a bit unstable at the time */

IriSP.PopcornReplacement = {  
};

/** base class for our popcorn-compatible players.
 */
IriSP.PopcornReplacement.player = function(container, options) {
  /* the jwplayer calls the callbacks in the global space so we need to 
     preserve them using IriSP.wrap */
  this.callbacks = {
      onReady:  IriSP.wrap(this, this.__initApi),
      onTime:   IriSP.wrap(this, this.__timeHandler),
      onPlay:   IriSP.wrap(this, this.__playHandler),
      onPause:  IriSP.wrap(this, this.__pauseHandler),
      onSeek:   IriSP.wrap(this, this.__seekHandler) 
  };
  
  this.media = { 
    "paused": true,
    "muted": false
  };
    
  this.container = container.slice(1); //eschew the '#'
  
  this.msgPump = {}; /* dictionnary used to receive and send messages */
  this.__codes = []; /* used to schedule the execution of a piece of code in 
                        a segment (similar to the popcorn.code plugin). */
  
  this._options = options;
                          
};

IriSP.PopcornReplacement.player.prototype.listen = function(msg, callback) {
  if (!this.msgPump.hasOwnProperty(msg))
    this.msgPump[msg] = [];

  this.msgPump[msg].push(callback);
};

IriSP.PopcornReplacement.player.prototype.trigger = function(msg, params) {
  if (!this.msgPump.hasOwnProperty(msg))
    return;

  var d = this.msgPump[msg];

  for(var i = 0; i < d.length; i++) {
    d[i].call(window, params);
  }

};

IriSP.PopcornReplacement.player.prototype.guid = function(prefix) {
  var str = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
   });

  return prefix + str;
};

/** init the api after that flash player has been setup - called by the callback
    defined by the embedded flash player 
*/
IriSP.PopcornReplacement.player.prototype.__initApi = function() {
  this.trigger("loadedmetadata"); // we've done more than loading metadata of course,
                                                      // but popcorn doesn't need to know more.
  this.media.muted = this.playerFns.getMute();
  /* some programmed segments are supposed to be run at the beginning */
  var i = 0;
  for(i = 0; i < this.__codes.length; i++) {
    var c = this.__codes[i];
    if (0 == c.start) {
      c.onStart();
    }
    
    if (0 == c.end) {
      c.onEnd();
    }
  }
};

/*
IriSP.PopcornReplacement.jwplayer = function(container, options) {
  IriSP.PopcornReplacement._container = container.slice(1); //eschew the '#'
  options.events = {
      onReady: IriSP.PopcornReplacement.__initApi,
      onTime: IriSP.PopcornReplacement.__timeHandler,
      onPlay: IriSP.PopcornReplacement.__playHandler,
      onPause: IriSP.PopcornReplacement.__pauseHandler,
      onSeek: IriSP.PopcornReplacement.__seekHandler 
      }
    
  jwplayer(IriSP.PopcornReplacement._container).setup(options);
  IriSP.PopcornReplacement.media.duration = options.duration;
  return IriSP.PopcornReplacement;
};
*/

IriSP.PopcornReplacement.player.prototype.currentTime = function(time) {
  if (typeof(time) === "undefined") {        
      return this.playerFns.getPosition();            
  } else {
     var currentTime = +time;
     this.playerFns.seek(currentTime);              
     return currentTime;
  }
};

IriSP.PopcornReplacement.player.prototype.play = function() {
  this.media.paused = false;
  this.trigger("play");
  //IriSP.PopcornReplacement.trigger("playing");
  this.playerFns.play();
};
    
IriSP.PopcornReplacement.player.prototype.pause = function() {
  if ( !this.media.paused ) {
    this.media.paused = true;
    this.trigger( "pause" );
    this.playerFns.pause();
  }
};

IriSP.PopcornReplacement.player.prototype.muted = function(val) {
  if (typeof(val) !== "undefined") {

    if (this.playerFns.getMute() !== val) {
      if (val) {
        this.playerFns.setMute(true);
        this.media.muted = true;
      } else {
        this.playerFns.setMute(false);
        this.media.muted = false;
      }

      this.trigger( "volumechange" );
    }
    
    return this.playerFns.getMute();
  } else {
    return this.playerFns.getMute();
  }
};

IriSP.PopcornReplacement.player.prototype.mute = IriSP.PopcornReplacement.player.prototype.muted;

IriSP.PopcornReplacement.player.prototype.code = function(options) {
  this.__codes.push(options);
  return this;
};

/* called everytime the player updates itself 
   (onTime event)
 */

IriSP.PopcornReplacement.player.prototype.__timeHandler = function(event) {
  var pos = event.position;

  var i = 0;
  for(i = 0; i < this.__codes.length; i++) {
     var c = this.__codes[i];

     if (pos >= c.start && pos < c.end && 
         pos - 1 <= c.start) {       
        c.onStart();
     }
 
     if (pos > c.start && pos > c.end && 
         pos - 1 <= c.end) {
         c.onEnd();
     }
   
  }
 
  this.trigger("timeupdate");
};

IriSP.PopcornReplacement.player.prototype.__seekHandler = function(event) {
  var i = 0;
  
  for(i = 0; i < this.__codes.length; i++) {
     var c = this.__codes[i];
    
     if (event.position >= c.start && event.position < c.end) {        
        c.onEnd();
     }         
   }
  
   for(i = 0; i < this.__codes.length; i++) {
     var c = this.__codes[i];

     if (typeof(event.offset) === "undefined")
       event.offset = 0;
           
     if (event.offset >= c.start && event.offset < c.end) { 
       c.onStart();
     }
     
   }
  
  /* this signal sends as an extra argument the position in the video.
     As far as I know, this argument is not provided by popcorn */
  this.trigger("seeked", event.offset);  
};

IriSP.PopcornReplacement.player.prototype.__playHandler = function(event) {
  this.media.paused = false;
  this.trigger("play");
};

IriSP.PopcornReplacement.player.prototype.__pauseHandler = function(event) {
  this.media.paused = true;
  this.trigger("pause");
};

IriSP.PopcornReplacement.player.prototype.roundTime = function() {
  var currentTime = this.currentTime();
  return Math.round(currentTime);
};/* data.js - this file deals with how the players gets and sends data */

IriSP.DataLoader = function() {
  this._cache = {};
  
  /*
    A structure to hold callbacks for specific urls. We need it because
    ajax calls are asynchronous, so it means that sometimes we ask
    multiple times for a ressource because the first call hasn't been
    received yet.
  */
  this._callbacks = {};
};

IriSP.DataLoader.prototype.get = function(url, callback) {

  var base_url = url.split("&")[0]
  if (this._cache.hasOwnProperty(base_url)) {
    callback(this._cache[base_url]);
  } else {  
    if (!this._callbacks.hasOwnProperty(base_url)) {
      this._callbacks[base_url] = [];
      this._callbacks[base_url].push(callback);   
      /* we need a closure because this gets lost when it's called back */
  
      // uncomment you don't want to use caching.
      // IriSP.jQuery.get(url, callback);
      
      var func = function(data) {
                  this._cache[base_url] = data;                                
                  var i = 0;
                  
                  for (i = 0; i < this._callbacks[base_url].length; i++) {
                    this._callbacks[base_url][i](this._cache[base_url]);                                  
                  }
      };
      
      /* automagically choose between json and jsonp */
      if (url.indexOf(document.location.hostname) === -1 &&
          url.indexOf("http://") !== -1 /* not a relative url */ ) {
        // we contacting a foreign domain, use JSONP

        IriSP.jQuery.get(url, {}, IriSP.wrap(this, func), "jsonp");
      } else {

        // otherwise, hey, whatever rows your boat
        IriSP.jQuery.get(url, IriSP.wrap(this, func));
      }
    
    } else {
      /* simply push the callback - it'll get called when the ressource
         has been received */
      
      this._callbacks[base_url].push(callback);   
   
    }
  }
}

/* the base abstract "class" */
IriSP.Serializer = function(DataLoader, url) {
  this._DataLoader = DataLoader;
  this._url = url;
  this._data = [];
};

IriSP.Serializer.prototype.serialize = function(data) { };
IriSP.Serializer.prototype.deserialize = function(data) {};

IriSP.Serializer.prototype.currentMedia = function() {  
};

IriSP.Serializer.prototype.sync = function(callback) {  
  callback.call(this, this._data);  
};

IriSP.SerializerFactory = function(DataLoader) {
  this._dataloader = DataLoader;
};

IriSP.SerializerFactory.prototype.getSerializer = function(metadataOptions) {
  /* This function returns serializer set-up with the correct
     configuration - takes a metadata struct describing the metadata source
  */
  
  if (metadataOptions === undefined)
    /* return an empty serializer */
    return IriSP.Serializer("", "");
            
  switch(metadataOptions.type) {
    case "json":
      return new IriSP.JSONSerializer(this._dataloader, metadataOptions.src);
      break;
    
    case "dummy": /* only used for unit testing - not defined in production */
      return new IriSP.MockSerializer(this._dataloader, metadataOptions.src);
      break;
    
    case "empty":
      return new IriSP.Serializer("", "empty");
      break;
      
    default:      
      return undefined;
  }
};
/* site.js - all our site-dependent config : player chrome, cdn locations, etc...*/

IriSP.defaults = {};

/* these objects are filled by configureDefaults. The function doesn't overwrite 
   defaults that were originally defined by the user.
*/
IriSP.lib = {};

/* We need to define those so that the individual settings can be overwritten */
IriSP.widgetsDefaults = {};

IriSP.paths = {};

IriSP.libdir = "/mdp/src/js/libs/";
IriSP.jwplayer_swf_path = "/mdp/test/libs/player.swf";
IriSP.platform_url = "http://localhost/pf";
IriSP.default_templates_vars = { };

/** ugly ugly ugly ugly - returns an object defining 
    the paths to the libs
    We need it that way cause it's called at runtime by
    IriSP.configureDefaults.
*/   
IriSP.defaults.lib = function(libdir) {
  if (IriSP.null_or_undefined(libdir))
    libdir = IriSP.libdir;
  
  return { 
      jQuery : "http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.js",
      jQueryUI : "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8.17/jquery-ui.js",
      jQueryToolTip : "http://cdn.jquerytools.org/1.2.4/all/jquery.tools.min.js",
      swfObject : "http://ajax.googleapis.com/ajax/libs/swfobject/2.2/swfobject.js",
      cssjQueryUI : "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8.4/themes/base/jquery-ui.css",
      popcorn : libdir + "popcorn.js",
      jwplayer : libdir + "jwplayer.js",
      popcornReplacement: libdir + "pop.js",
      raphael: libdir + "raphael.js",
      jquery_sparkline: libdir + "jquery.sparkline.js",
      "popcorn.mediafragment" : libdir + "popcorn.mediafragment.js",
      "popcorn.code" : libdir + "popcorn.code.js",
      "popcorn.jwplayer": libdir + "popcorn.jwplayer.js",
      "popcorn.youtube": libdir + "popcorn.youtube.js"    
  };
};

//Configuration for the player and utility functions.
// No need to have them configured at runtime
IriSP.config = {};

IriSP.config.shortener = {
  // function to call to shorten an url.
  //shortening_function : IriSP.platform_shorten_url
};

IriSP.defaults.widgetsDefaults = function(platform_url) { 
  if (IriSP.null_or_undefined(platform_url))
    platform_url = IriSP.platform_url;
  
  return {
    "LayoutManager" : {spacer_div_height : "0px" },
    "PlayerWidget" : {},
    "AnnotationsWidget": {
      "share_text" : "I'm watching ",     
      "fb_link" : "http://www.facebook.com/share.php?u=",
      "tw_link" : "http://twitter.com/home?status=",
      "gplus_link" : ""
      },
    
    "TweetsWidget" : {
        default_profile_picture : "https://si0.twimg.com/sticky/default_profile_images/default_profile_1_normal.png",
        tweet_display_period: 10000 // how long do we show a tweet ?
        
    },
    "SliderWidget" : {
        minimize_period: 850 // how long does the slider stays maximized after the user leaves the zone ?
    },
    "createAnnotationWidget" : {
        keywords: ["#faux-raccord", "#mot-clef"],
        polemic_mode: true, /* enable polemics ? */
        /* polemics - the corresponding class names defined in the css should be for instance :
           Ldt-createAnnotation-polemic-plusplus for plusplus
           Ldt-createAnnotation-polemic-equalequal for equalequal, etc.
        */
        polemics: {"++" : "positive", "--" : "negative", "==" : "reference", "??" : "question"}, 
        cinecast_version: true /* put to false to enable the platform version, true for the festival cinecast one. */
    },
    "SparklineWidget" : {
        column_width: 10 // the width of a column in pixels.
    },
    "Main" : {
        autoplay: true
    },
    "AnnotationsListWidget" : {
        ajax_mode: true, /* use ajax to get information about the annotations.
                           if set to false, only search in the annotations for the
                           current project. */
                           
        /* the platform generates some funky urls. We replace them afterwards to point to the
           correct place - this setting will probably be overwritten by the platform 
           implementers.
           Note that the player has to replace the variables between {{ and }} by its own values.
        */
        ajax_url: platform_url + "/ldtplatform/api/ldt/segments/{media}/{begin}/{end}", 
        ajax_granularity: 10000, /* how much ms should we look before and after the
                                   current timecode */
        
        project_url: platform_url + "/ldtplatform/ldt/front/player/" /* the beginning 
                                                                        of a link to the
                                                                        new front */
    } 
  };
};

IriSP.defaults.paths = {
//  "imgs": "/tweetlive/res/metadataplayer/src/css/imgs"
  "imgs": "/mdp/src/css/imgs"
};

IriSP.defaults.default_templates_vars = function() { 
  return {
  "img_dir" : IriSP.paths.imgs 
  };
}

/*
Override this if you want to change the info the player receives about the user.
It's typically overrided in server-side templates with user-specific data.
*/
IriSP.defaults.user = function() {
  return {
      "name" : "Anonymous user",
      "avatar" : IriSP.paths.imgs + "/user_default_icon.png"
    }  
};
/* the widget classes and definitions */

/**
  * @class Widget is an "abstract" class. It's mostly used to define some properties common to every widget.
  *
  *  Note that widget constructors are never called directly by the user. Instead, the widgets are instantiated by functions
  *  defined in init.js
  *  
  * @constructor
  * @param Popcorn a reference to the popcorn Object
  * @param config configuration options for the widget
  * @param Serializer a serializer instance from which the widget reads data fromCharCode  
*/
IriSP.Widget = function(Popcorn, config, Serializer) {

  if (config === undefined || config === null) {
    config = {}
  }
  
  this._Popcorn = Popcorn;
  this._config = config;  
  this._serializer = Serializer;
  
  if (config.hasOwnProperty("container")) {
     this._id = config.container;
     this.selector = IriSP.jQuery("#" + this._id);
  }

  if (config.hasOwnProperty("spacer")) {
     this._spacerId = config.spacer;
     this.spacer = IriSP.jQuery("#" + this._spacerId);
  }


  if (config.hasOwnProperty("width")) {
     // this.width and not this._width because we consider it public.
     this.width = config.width;     
  }
  
  if (config.hasOwnProperty("height")) {    
     this.height = config.height;     
  }
  
  if (config.hasOwnProperty("heightmax")) {
     this.heightmax = config.heightmax;     
  }

  if (config.hasOwnProperty("widthmax")) {
     this.widthmax = config.widthmax;     
  } 

  if (config.hasOwnProperty("layoutManager")) {
     this.layoutManager = config.layoutManager;     
  }
  
};

/**
  * This method responsible of drawing a widget on screen.
  */
IriSP.Widget.prototype.draw = function() {
  /* implemented by "sub-classes" */  
};

/**
  * Optional method if you want your widget to support redraws.
  */
IriSP.Widget.prototype.redraw = function() {
  /* implemented by "sub-classes" */  
};
/* modules are non-graphical entities, similar to widgets */

IriSP.Module = function(Popcorn, config, Serializer) {

  if (config === undefined || config === null) {
    config = {}
  }
  
  this._Popcorn = Popcorn;
  this._config = config;  
  this._serializer = Serializer;
};
/* layout.js - very basic layout management */

/**
  @class a layout manager manages a div and the layout of objects
  inside it.
*/
IriSP.LayoutManager = function(options) {
    this._Popcorn = null;
    this._widgets = [];
    
    this._div = "LdtPlayer";
    this._width = 640;
    
    if (options === undefined) {
      options = {};
    };
    
    if (options.hasOwnProperty('container')) {
      this._div = options.container;
    }

    if (options.hasOwnProperty('width')) {
      this._width = options.width;
    }    
    
    if (options.hasOwnProperty('height')) {
      this._height = options.height;
    } 
    
    /* this is a shortcut */
    this.selector = IriSP.jQuery("#" + this._div);
    
    this.selector.css("width", this._width);
    
    if (this._height !== undefined)
      this.selector.css("height", this._height);
};

/** 
   Set the popcorn instance used by the manager.
   
   we need this special setter because of a chicken and egg problem :
   we want the manager to use popcorn but the popcorn div will be managed
   by the manager. So we need a way to set the instance the manager uses
*/
   
IriSP.LayoutManager.prototype.setPopcornInstance = function(popcorn) {
    this._Popcorn = popcorn;
}

/** create a subdiv with an unique id, and a spacer div as well.
    @param widgetName the name of the widget.
    @return an array of the form [createdivId, spacerdivId].
*/
IriSP.LayoutManager.prototype.createDiv = function(widgetName) {
    if (typeof(widgetName) === "undefined")
       widgetName = "";

    var newDiv = IriSP.guid(this._div + "_widget_" + widgetName + "_");
    var spacerDiv = IriSP.guid("LdtPlayer_spacer_");
    this._widgets.push([widgetName, newDiv]);    

    var divTempl = "<div id='{{id}}' style='width: {{width}}px; position: relative;'></div";
    var spacerTempl = "<div id='{{spacer_id}}' style='width: {{width}}px; position: relative; height: {{spacer_div_height}};'></div";
    
    var divCode = Mustache.to_html(divTempl, {id: newDiv, width: this._width});
    var spacerCode = Mustache.to_html(spacerTempl, {spacer_id: spacerDiv, width: this._width,
                                                    spacer_div_height: IriSP.widgetsDefaults.LayoutManager.spacer_div_height });

    this.selector.append(divCode);
    this.selector.append(spacerCode);

    return [newDiv, spacerDiv];
};/* init.js - initialization and configuration of Popcorn and the widgets
exemple json configuration:
 
 */

/**
    set up the IriSP.__dataloader instance - 
    we need it because we have to get the metadata
    about the video before that the widget have even
    loaded.
*/
IriSP.setupDataLoader = function() {
  /* we set it up separately because we need to
     get data at the very beginning, for instance when
     setting up the video */
  IriSP.__dataloader = new IriSP.DataLoader();
};

/** do some magic to configure popcorn according to the options object passed.
    Works for html5, jwplayer and youtube videos 
*/
IriSP.configurePopcorn = function (layoutManager, options) {
    var pop;
    var ret = layoutManager.createDiv(); 
    var containerDiv = ret[0];
    var spacerDiv = ret[1];
    
    /* insert one pixel of margin between the video and the first widget, using the 
       spacer.
    */
    IriSP.jQuery("#" + spacerDiv).css("height", "1px");
    
    switch(options.type) {
      /*
        todo : dynamically create the div/video tag which
        will contain the video.
      */
      case "html5":
           var tmpId = Popcorn.guid("video"); 
           IriSP.jQuery("#" + containerDiv).append("<video src='" + options.file + "' id='" + tmpId + "'></video>");

           if (options.hasOwnProperty("width"))
             IriSP.jQuery("#" + containerDiv).css("width", options.width);
           
           if (options.hasOwnProperty("height"))
             IriSP.jQuery("#" + containerDiv).css("height", options.height);

           pop = Popcorn("#" + tmpId);
        break;
        
      case "jwplayer":
          var opts = IriSP.jQuery.extend({}, options);
          delete opts.container;
          delete opts.type;

          
          /* Try to guess options.file and options.streamer only if file and streamer
             are not already defined in the configuration */
          if (options.provider === "rtmp" && !opts.hasOwnProperty("file") && !opts.hasOwnProperty("streamer")) {
            /* exit if we can't access the metadata */
            if (typeof(IriSP.__jsonMetadata) === "undefined") {
                break;
            };

            // the json format is totally illogical
            //opts.streamer = IriSP.__jsonMetadata["medias"][0]["meta"]["item"]["value"];
            //var source = IriSP.__jsonMetadata["medias"][0]["href"];

            // the source if a full url but jwplayer wants an url relative to the
            // streamer url, so we've got to remove the common part.
            //opts.file = source.slice(opts.streamer.length);
            
            /* sometimes we get served a file with a wrong path and streamer.
               as a streamer is of the form rtmp://domain/path/ and the media is
               the rest, we uglily do this :
            */
            opts.file = "";
            opts.streamer = "";
            var fullPath = IriSP.__jsonMetadata["medias"][0]["href"];
            var pathSplit = fullPath.split('/');
            
            for (var i = 0; i < pathSplit.length; i++) {
              if (i < 4) {
                 opts.streamer += pathSplit[i] + "/";
              } else {
                 opts.file += pathSplit[i];
                 /* omit the last slash if we're on the last element */
                 if (i < pathSplit.length - 1)
                  opts.file += "/";
              }
            }            
          } else {
            /* other providers type, video for instance -
               pass everything as is */
          }

          if (!options.hasOwnProperty("flashplayer")) {
            opts.flashplayer = IriSP.jwplayer_swf_path;
          }

          if (!options.hasOwnProperty("controlbar.position")) {
            opts["controlbar.position"] = "none";
          }

          pop = new IriSP.PopcornReplacement.jwplayer("#" + containerDiv, opts);
        break;
      
      case "youtube":
          var opts = IriSP.jQuery.extend({}, options);
          delete opts.container;
          opts.controls = 0;
          opts.autostart = false;
          templ = "width: {{width}}px; height: {{height}}px;";
          var str = Mustache.to_html(templ, {width: opts.width, height: opts.height});    
          // Popcorn.youtube wants us to specify the size of the player in the style attribute of its container div.
          IriSP.jQuery("#" + containerDiv).attr("style", str);
          
          pop = Popcorn.youtube("#" + containerDiv, opts.video, opts);
        break;
      
    case "dailymotion":
        pop = new IriSP.PopcornReplacement.dailymotion("#" + containerDiv, options);
        break;
             
      case "allocine":
          /* pass the options as-is to the allocine player and let it handle everything */
          pop = new IriSP.PopcornReplacement.allocine("#" + containerDiv, options);
          break;
          
      default:
        pop = undefined;
    };
    
    return pop;
};

/** Configure the gui and instantiate the widgets passed as parameters
    @param guiOptions the gui object as seen in the examples.
 */
IriSP.configureWidgets = function (popcornInstance, layoutManager, guiOptions) {
 
  var serialFactory = new IriSP.SerializerFactory(IriSP.__dataloader);
  var params = {width: guiOptions.width, height: guiOptions.height};

  var ret_widgets = [];
  var index;
  
  for (index = 0; index < guiOptions.widgets.length; index++) {    
    var widgetConfig = guiOptions.widgets[index];
    var widget = IriSP.instantiateWidget(popcornInstance, serialFactory, layoutManager, widgetConfig);
        
    ret_widgets.push(widget);   
  };

  return ret_widgets;
};

/** configure modules. @see configureWidgets */
IriSP.configureModules = function (popcornInstance, modulesList) {
  if (IriSP.null_or_undefined(modulesList))
    return;
  
  var serialFactory = new IriSP.SerializerFactory(IriSP.__dataloader);
  var ret_modules = [];
  var index;
  
  for (index = 0; index < modulesList.length; index++) {    
    var moduleConfig = modulesList[index];
    
    var serializer = serialFactory.getSerializer(moduleConfig.metadata);
    var module = new IriSP[moduleConfig.type](popcornInstance, moduleConfig, serializer);    
    ret_modules.push(module);
  };

  return ret_modules;
};

/** instantiate a widget - only called by configureWidgets, never by the user. Handles widget 
    dependencies.
    @param popcornInstance popcorn instance the widget will user
    @param serialFactory serializer factory to instantiate the widget with
    @param layoutManager layout manager
    @param widgetConfig configuration options for the widget
 */
IriSP.instantiateWidget = function(popcornInstance, serialFactory, layoutManager, widgetConfig) {

    var arr = IriSP.jQuery.extend({}, widgetConfig);
    
    /* create a div for those widgets who didn't already specify a container; */
    if (!arr.hasOwnProperty("container")) {
      /* create div returns us a container for the widget and a spacer */    
      var ret = layoutManager.createDiv(widgetConfig.type);        
      var container = ret[0];
      var spacer = ret[1];           
      arr.container = container;
      arr.spacer = spacer;
      arr.layoutManager = layoutManager;
    }
    var serializer = serialFactory.getSerializer(widgetConfig.metadata);    
    
    if (typeof serializer == "undefined")   
      debugger;
    
    // instantiate the object passed as a string
    var widget = new IriSP[widgetConfig.type](popcornInstance, arr, serializer);    
    
    if (widgetConfig.hasOwnProperty("requires")) {
      // also create the widgets this one depends on.
      // the dependency widget is available in the parent widget context as
      // this.WidgetName (for instance, this.TipWidget);
      
      var i = 0;
      for(i = 0; i < widgetConfig.requires.length; i++) {
        var widgetName = widgetConfig.requires[i]["type"];
        widget[widgetName] = IriSP.instantiateWidget(popcornInstance, serialFactory, layoutManager, widgetConfig.requires[i]);
      }
    }       
     
    serializer.sync(IriSP.wrap(widget, function() { this.draw(); }));
    return widget;
};

/** Go through the defaults to set a reasonable value */
IriSP.configureDefaults = function(libdir, platform_url) {
  /* the defaults configuration is messy and complicated. There are two things to know :
     - we want to allow overwriting of defaults - that's why we have IriSP.widgetDefaults
       and IriSP.defaults.widgetDefaults. The first is filled by the embedder and then fleshed out
       with the contents of the first. We use underscore.defaults for that, but there's one problem with
       this function : it doesn't work recursively.
     - we need to compute some values at runtime instead of at compile time
  */
    
  IriSP.lib = IriSP.underscore.defaults(IriSP.lib, IriSP.defaults.lib(libdir));
  
  /* get the factory defaults for the widgets and merge them with the default the user
     may have defined 
  */
  var factory_defaults = IriSP.defaults.widgetsDefaults(platform_url);
  for(var widget in factory_defaults) {
  
      /* create the object if it doesn't exists */
      if (IriSP.null_or_undefined(IriSP.widgetsDefaults[widget]))
        IriSP.widgetsDefaults[widget] = {};
        
      IriSP.widgetsDefaults[widget] = IriSP.underscore.defaults(IriSP.widgetsDefaults[widget], factory_defaults[widget]);
  }
  
  IriSP.paths = IriSP.underscore.defaults(IriSP.paths, IriSP.defaults.paths);
  IriSP.default_templates_vars = IriSP.underscore.defaults(IriSP.default_templates_vars, 
                                       IriSP.defaults.default_templates_vars());

  if (IriSP.null_or_undefined(IriSP.user))
    IriSP.user = {};
  
  IriSP.user = IriSP.underscore.defaults(IriSP.user, IriSP.defaults.user());
};

/** single point of entry for the metadataplayer */
IriSP.initPlayer = function(config, metadata_url, libdir, platform_url) {
    IriSP.configureDefaults(libdir, platform_url);
    IriSP.loadLibs(IriSP.lib, config, metadata_url,
      function() {   
              
              var layoutManager = new IriSP.LayoutManager(config.gui);

              var pop = IriSP.configurePopcorn(layoutManager, config.player);
              
              var widgets = IriSP.configureWidgets(pop, layoutManager, config.gui); 
              var modules = IriSP.configureModules(pop, config.modules); 
      });
};/* To wrap a player the develop should create a new class derived from
the IriSP.PopcornReplacement.player and defining the correct functions */

/** jwplayer player wrapper */
IriSP.PopcornReplacement.dailymotion = function(container, options) {
    console.log("Calling");
    /* appel du parent pour initialiser les structures communes à tous les players */
    IriSP.PopcornReplacement.player.call(this, container, options);   
    
    var _this = this;

    /* Définition des fonctions de l'API -  */

    this.playerFns = {
        play : function() {
            if (_this.player) {
                return _this.player.playVideo();
            } else {
                return false;
            }
        },
        pause : function() {
            if (_this.player) {
                return _this.player.pauseVideo();
            } else {
                return false;
            }
        },
        getPosition : function() {
            if (_this.player) {
                return _this.player.getCurrentTime();
            } else {
                return 0;
            }
        },
        seek : function(pos) {
            if (_this.player) {
                return _this.player.seekTo(pos);
            } else {
                return false;
            }
        },
        getMute : function() {
            if (_this.player) {
                return _this.player.isMuted();
            } else {
                return false;
            }
        },
        setMute : function(p) {
            if (_this.player) {
                return p ? _this.player.mute() : _this.player.unMute();
            } else {
                return false;
            }
        }
    }

    window.onDailymotionPlayerReady = IriSP.wrap(this, this.ready);
    window.onDailymotionStateChange = IriSP.wrap(this, this.stateHandler);
    window.onDailymotionVideoProgress = IriSP.wrap(this, this.progressHandler);

    var params = {
        "allowScriptAccess" : "always",
        "wmode": "opaque"
    };
    var atts = {
        id : this.container
    };
    swfobject.embedSWF("http://www.dailymotion.com/swf?chromeless=1&enableApi=1", this.container, options.width, options.height, "8", null, null, params, atts);

};

IriSP.PopcornReplacement.dailymotion.prototype = new IriSP.PopcornReplacement.player("", {});

IriSP.PopcornReplacement.dailymotion.prototype.ready = function() {
    
    this.player = document.getElementById(this.container);
    
    this.player.addEventListener("onStateChange", "onDailymotionStateChange");
    this.player.addEventListener("onVideoProgress", "onDailymotionVideoProgress");
    this.player.cueVideoByUrl(this._options.video);
    
    this.callbacks.onReady();
};

IriSP.PopcornReplacement.dailymotion.prototype.progressHandler = function(progressInfo) {
    
    this.callbacks.onTime({
        position: progressInfo.mediaTime
    });
}

IriSP.PopcornReplacement.dailymotion.prototype.stateHandler = function(state) {
    
    switch(state) {
        case 1:
            this.callbacks.onPlay();
            break;

        case 2:
            this.callbacks.onPause();
            break;

        case 3:
            this.callbacks.onSeek({
                position: this.player.getCurrentTime()
            });
            break;

        /*
        case 5:
            this.callbacks.onReady();
            break;
        */
    }
    
};/* To wrap a player the develop should create a new class derived from 
   the IriSP.PopcornReplacement.player and defining the correct functions */

/** jwplayer player wrapper */
IriSP.PopcornReplacement.jwplayer = function(container, options) {

  /* appel du parent pour initialiser les structures communes à tous les players */
  IriSP.PopcornReplacement.player.call(this, container, options);
  
  this.media.duration = options.duration; /* optional */
  
  /* Définition des fonctions de l'API -  */
  this.playerFns = {
    play: function() { return jwplayer(this.container).play(); },
    pause: function() { return jwplayer(this.container).pause(); },
    getPosition: function() { return jwplayer(this.container).getPosition(); },
    seek: function(pos) { return jwplayer(this.container).seek(pos); },
    getMute: function() { return jwplayer(this.container).getMute() },
    setMute: function(p) { return jwplayer(this.container).setMute(p); }
  }

  options.events = this.callbacks;

  jwplayer(this.container).setup(options);
};

IriSP.PopcornReplacement.jwplayer.prototype = new IriSP.PopcornReplacement.player("", {});
/* mediafragment module */

IriSP.MediaFragment = function(Popcorn, config, Serializer) {
  IriSP.Module.call(this, Popcorn, config, Serializer);

  this.mutex = false; /* a mutex because we access the url from two different functions */

  this._Popcorn.listen( "loadedmetadata", IriSP.wrap(this,this.advanceTime));
  this._Popcorn.listen( "pause", IriSP.wrap(this,this.updateTime));
  this._Popcorn.listen( "seeked", IriSP.wrap(this,this.updateTime));
  this._Popcorn.listen( "IriSP.PolemicTweet.click", IriSP.wrap(this,this.updateAnnotation));
  this._Popcorn.listen( "IriSP.SegmentsWidget.click", IriSP.wrap(this,this.updateAnnotation));
  
  window.onhashchange = IriSP.wrap(this, this.advanceTime);
};

IriSP.MediaFragment.prototype = new IriSP.Module();

IriSP.MediaFragment.prototype.advanceTime = function() {
             var url = window.location.href;

              if ( url.split( "#" )[ 1 ] != null ) {
                  pageoffset = url.split( "#" )[1];

                  if ( pageoffset.substring(0, 2) === "t=") {
                    // timecode 
                    if ( pageoffset.substring( 2 ) != null ) {
                    var offsettime = pageoffset.substring( 2 );
                    this._Popcorn.currentTime( parseFloat(offsettime) );
                    
                    /* we have to trigger this signal manually because of a
                     bug in the jwplayer */
                    this._Popcorn.trigger("seeked", parseFloat(offsettime));
                    }
                  } else if ( pageoffset.substring(0, 3) === "id=") {
                    // annotation
                    var annotationId = pageoffset.substring( 3 );
                    // there's no better way than that because
                    // of possible race conditions
                    this._serializer.sync(IriSP.wrap(this, function() {
                          this.lookupAnnotation.call(this, annotationId); 
                          }));
                  }                                    
              }
};

/** handler for the seeked signal. It may have or may have not an argument.
    @param time if not undefined, the time we're seeking to 
*/
IriSP.MediaFragment.prototype.updateTime = function(time) {
  if (this.mutex === true) {
    return;
  }

  var history = window.history;
  if ( !history.pushState ) {
    return false;
  }
    
  if (IriSP.null_or_undefined(time) || typeof(time) != "number") {
    var ntime = this._Popcorn.currentTime().toFixed(2)
  } else {
    var ntime = time.toFixed(2);
  }
  
  splitArr = window.location.href.split( "#" )
  history.replaceState( {}, "", splitArr[0] + "#t=" + ntime );
};


IriSP.MediaFragment.prototype.updateAnnotation = function(annotationId) {
  var _this = this;
  this.mutex = true;

  var history = window.history;
  if ( !history.pushState ) {
    return false;
  }
  
  splitArr = window.location.href.split( "#" )
  history.replaceState( {}, "", splitArr[0] + "#id=" + annotationId);
 
  // reset the mutex afterwards to prevent the module from reacting to his own changes.
  window.setTimeout(function() { _this.mutex = false }, 50);
};

// lookup and seek to the beginning of an annotation
IriSP.MediaFragment.prototype.lookupAnnotation = function(annotationId) {
  var _this = this;
  this.mutex = true;

  var annotation = undefined;
  var annotations = this._serializer._data.annotations;

  var i;
  for (i = 0; i < annotations.length; i++) {
      if (annotations[i].id === annotationId) {
        annotation = annotations[i];
        break;
      }
  }

  if (typeof(annotation) !== "undefined") {
    this._Popcorn.currentTime(annotation.begin / 1000);

    /* we have to trigger this signal manually because of a
     bug in the jwplayer */
    this._Popcorn.trigger("seeked", annotation.begin / 1000);
    this._Popcorn.trigger("IriSP.Mediafragment.showAnnotation", annotationId);
  }
  
  window.setTimeout(function() { _this.mutex = false }, 50);
};
IriSP.AnnotationsListWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  this.__counter = 0;
  this.__oldList = [];
  
  this.ajax_mode = IriSP.widgetsDefaults["AnnotationsListWidget"].ajax_mode;
  this.project_url = IriSP.widgetsDefaults["AnnotationsListWidget"].project_url;  
};


IriSP.AnnotationsListWidget.prototype = new IriSP.Widget();

IriSP.AnnotationsListWidget.prototype.clear = function() {
};

IriSP.AnnotationsListWidget.prototype.clearWidget = function() {
};

/** effectively redraw the widget - called by drawList */
IriSP.AnnotationsListWidget.prototype.do_redraw = function(list) {
    var widgetMarkup = IriSP.templToHTML(IriSP.annotationsListWidget_template, {annotations: list});
    this.selector.html(widgetMarkup);
};

/** draw the annotation list */
IriSP.AnnotationsListWidget.prototype.drawList = function(force_redraw) {
  var _this = this;
  
  var view_type = this._serializer.getContributions();
  var annotations = this._serializer._data.annotations;
  var currentTime = this._Popcorn.currentTime();
    
  var list = [];

  if (typeof(view_type) === "undefined") {    
    return;
  }

  for (i = 0; i < annotations.length; i++) {
    var annotation = annotations[i];

    /* filter the annotations whose type is not the one we want */
    if (typeof(annotation.meta) !== "undefined" && typeof(annotation.meta["id-ref"]) !== "undefined"
          && annotation.meta["id-ref"] !== view_type) {
        continue;
    }

    /* only get the annotations happening in the current chapter */
    if (!(annotation.begin <= currentTime * 1000 && annotation.end > currentTime * 1000)) {        
        continue;
    }

    var a = annotation;
    var obj = {};

    obj["id"] = a.id;
    obj["title"] = a.content.title;
    obj["desc"] = a.content.description;
    obj["begin"] = IriSP.msToTime(annotation.begin);
    obj["end"] = IriSP.msToTime(annotation.end);

    list.push(obj);
  }
  
  var idList = IriSP.underscore.pluck(list, "id").sort();

  if (idList.length !== this.__oldList.length) {
    this.do_redraw(list);
  }
    
  var res = 1;
  for (var i = 0; i < idList.length; i++) {
    if (idList[i] !== this.__oldList[i])
      res = 0;
      break;
  }
  
  this.__oldList = idList; /* save for next call */
  
  if (typeof(force_redraw) !== "undefined") {
    this.do_redraw(list);
  }
  
  /* the two lists are equal, no need to redraw */
  if (res === 1) {
    return;
  } else {
    this.do_redraw(list);
  }
  
};

IriSP.AnnotationsListWidget.prototype.ajaxRedraw = function(timecode) {

  /* the seeked signal sometimes passes an argument - depending on if we're using
     our popcorn lookalike or the real thing - if it's the case, use it as it's
     more precise than currentTime which sometimes contains the place we where at */
  if (IriSP.null_or_undefined(timecode) || typeof(timecode) != "number") {
     var tcode = this._Popcorn.currentTime();     
   } else {
     var tcode = timecode;     
  }
   
  
  /* the platform gives us a special url - of the type : http://path/{media}/{begin}/{end}
     we double the braces using regexps and we feed it to mustache to build the correct url
     we have to do that because the platform only knows at run time what view it's displaying.
  */
     
  var platf_url = IriSP.widgetsDefaults["AnnotationsListWidget"].ajax_url
                                      .replace(/\{/g, '{{').replace(/\}/g, '}}');
  var media_id = this._serializer.currentMedia()["id"];
  var duration = +this._serializer.currentMedia().meta["dc:duration"];
  
  var begin_timecode = (Math.floor(tcode) - 300) * 1000;
  if (begin_timecode < 0)
    begin_timecode = 0;
    
  var end_timecode = (Math.floor(tcode) + 300) * 1000;
  if (end_timecode > duration)
    end_timecode = duration;
  
  var templ = Mustache.to_html(platf_url, {media: media_id, begin: begin_timecode,
                                 end: end_timecode});

  /* we create on the fly a serializer to get the ajax */
  var serializer = new IriSP.JSONSerializer(IriSP.__dataloader, templ);
  serializer.sync(IriSP.wrap(this, function(json) { this.processJson(json, serializer) }));                  
};

/** process the received json - it's a bit hackish */
IriSP.AnnotationsListWidget.prototype.processJson = function(json, serializer) {
  /* FIXME: DRY the whole thing */
  var annotations = serializer._data.annotations;
  if (IriSP.null_or_undefined(annotations))
    return;
  
  /*
  commented in case we wanted to discriminate against some annotation types.
  var view_types = serializer.getIds("Contributions");
  */
  var l = [];
  
  var media = this._serializer.currentMedia()["id"];
  
  for (i = 0; i < annotations.length; i++) {
      var annotation = annotations[i];

      /* filter the annotations whose type is not the one we want */
      /* We want _all_ the annotations.
      if (typeof(annotation.meta) !== "undefined" && typeof(annotation.meta["id-ref"]) !== "undefined"
            && !IriSP.underscore.include(view_types, annotation.meta["id-ref"])) {
          continue;
      }
      */
      var a = annotation;
      var obj = {};

      obj["id"] = a.id;
      obj["title"] = a.content.title;
      obj["desc"] = a.content.description;
      obj["begin"] = IriSP.msToTime(annotation.begin);
      obj["end"] = IriSP.msToTime(annotation.end);

      /* only if the annotation isn't present in the document create an
         external link */
      if (!this.annotations_ids.hasOwnProperty(obj["id"])) {
        // braindead url; jacques didn't want to create a new one in the platform,
        // so we append the cutting id to the url.
        obj["url"] = this.project_url + "/" + media + "/" + 
                     annotation.meta["project"] + "/" +
                     annotation.meta["id-ref"];
        
        // obj["url"] = document.location.href.split("#")[0] + "/" + annotation.meta["project"];
      }
      
      l.push(obj);
  }

  this.do_redraw(l);
};
IriSP.AnnotationsListWidget.prototype.draw = function() {
  
  /* build a table of the annotations present in the document for faster 
     lookup
  */
  this.annotations_ids = {};
  
  var annotations = this._serializer._data.annotations;
  var i = 0;
  for(i = 0; i < annotations.length; i++) {
    this.annotations_ids[annotations[i]["id"]] = 1;
  }
  
  this.drawList();
    
  if (!this.ajax_mode) {    
    this._Popcorn.listen("IriSP.createAnnotationWidget.addedAnnotation", IriSP.wrap(this, function() { this.drawList(true); }));
    this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.redraw));
  } else {
    /* update the widget when the video has finished loading and when it's seeked and paused */
    this._Popcorn.listen("seeked", IriSP.wrap(this, this.ajaxRedraw));
    this._Popcorn.listen("loadedmetadata", IriSP.wrap(this, this.ajaxRedraw));
    this._Popcorn.listen("paused", IriSP.wrap(this, this.ajaxRedraw));
    
    this._Popcorn.listen("IriSP.createAnnotationWidget.addedAnnotation", IriSP.wrap(this, this.ajaxRedraw));
  }

};

IriSP.AnnotationsListWidget.prototype.redraw = function() {
  this.drawList();
};IriSP.AnnotationsWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  /* flag used when we're creating an annotation */
  this._hidden = false;
};


IriSP.AnnotationsWidget.prototype = new IriSP.Widget();

IriSP.AnnotationsWidget.prototype.clear = function() {
    this.selector.find(".Ldt-SaTitle").text("");
    this.selector.find(".Ldt-SaDescription").text("");
    this.selector.find(".Ldt-SaKeywordText").text("");
};

IriSP.AnnotationsWidget.prototype.displayAnnotation = function(annotation) {       
    var title = annotation.content.title;
    var description = annotation.content.description;
    var keywords =  "" // FIXME;
    var begin = +annotation.begin / 1000;
    var end = +annotation.end / 1000;
    var duration = +this._serializer.currentMedia().meta["dc:duration"];
    var tags = "";
    
    var title_templ = "{{title}} - ( {{begin}} - {{end}} )";
    var endstr = Mustache.to_html(title_templ, {title: title, begin: IriSP.secondsToTime(begin), end: IriSP.secondsToTime(end)});

    this.selector.find(".Ldt-SaTitle").text(endstr);
    this.selector.find(".Ldt-SaDescription").text(description);
    
    
    if (!IriSP.null_or_undefined(annotation.tags) && !IriSP.null_or_undefined(this._serializer._data.tags)) {
      /* save the tag id and keywords in a unique structure */
      var tag_list = {};
      for (var i = 0; i < this._serializer._data.tags.length; i++) {
        var id = this._serializer._data.tags[i]["id"];
        var keyword = this._serializer._data.tags[i]["meta"]["dc:title"];

        tag_list[id] = keyword;
      }

      /* then browse the list of defined tags for the current annotation */
      for (var i = 0; i < annotation.tags.length; i++) {
        if (tag_list.hasOwnProperty(annotation.tags[i]["id-ref"]))
          tags += tag_list[annotation.tags[i]["id-ref"]] + ", ";
      }
    }
    
    tags = "Keywords: " + tags.slice(0, tags.length - 2);
    
    this.selector.find(".Ldt-SaKeywords").text(tags);
    
    // update sharing buttons
    var defaults = IriSP.widgetsDefaults.AnnotationsWidget;
    var text = defaults.share_text;
    var fb_link = defaults.fb_link;
    var tw_link = defaults.tw_link;
    var gplus_link = defaults.gplus_link;
    var url = document.location.href + "#id=" + annotation.id;
    this.selector.find(".Ldt-fbShare").attr("href", IriSP.mkFbUrl(url, text));
    this.selector.find(".Ldt-TwShare").attr("href", IriSP.mkTweetUrl(url, text));
    this.selector.find(".Ldt-GplusShare").attr("href", IriSP.mkGplusUrl(url, text));
};

IriSP.AnnotationsWidget.prototype.clearWidget = function() {   
    /* retract the pane between two annotations */
    this.selector.find(".Ldt-SaTitle").text("");
    this.selector.find(".Ldt-SaDescription").text("");
    this.selector.find(".Ldt-SaKeywordText").html("");
    this.selector.find(".Ldt-ShowAnnotation").slideUp();
};

IriSP.AnnotationsWidget.prototype.draw = function() {
  var _this = this;

  var annotationMarkup = IriSP.templToHTML(IriSP.annotationWidget_template);
	this.selector.append(annotationMarkup);

  this._Popcorn.listen("IriSP.AnnotationsWidget.show", 
                        IriSP.wrap(this, this.show));
  this._Popcorn.listen("IriSP.AnnotationsWidget.hide", 
                        IriSP.wrap(this, this.hide));
 
  var legal_ids = [];
  if (typeof(this._serializer.getChapitrage()) !== "undefined")
    legal_ids.push(this._serializer.getChapitrage());
  else 
    legal_ids = this._serializer.getNonTweetIds();
  
  var annotations = this._serializer._data.annotations;
  var i;
  
	for (i in annotations) {    
    var annotation = annotations[i];
    var begin = Math.round((+ annotation.begin) / 1000);
    var end = Math.round((+ annotation.end) / 1000);

    if (typeof(annotation.meta) !== "undefined" && typeof(annotation.meta["id-ref"]) !== "undefined"
          && !IriSP.underscore.include(legal_ids, annotation.meta["id-ref"])) {
        continue;
    }


    var conf = {start: begin, end: end, 
                onStart: 
                       function(annotation) { 
                        return function() { 
                            _this.displayAnnotation(annotation); 
                          
                        } }(annotation),
                onEnd: 
                       function() { _this.clearWidget.call(_this); }
                };
    this._Popcorn = this._Popcorn.code(conf);                                             
  }

};

IriSP.AnnotationsWidget.prototype.hide = function() {
  if (this._hidden == false) {
    this.selector.hide();
    this._hidden = true;
  }
};

IriSP.AnnotationsWidget.prototype.show = function() {
  if (this._hidden == true) {
    this.selector.show();
    this._hidden = false;
  }
};IriSP.ArrowWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);

  this._oldAnnotation = null;
  this._blockArrow = false;
};


IriSP.ArrowWidget.prototype = new IriSP.Widget();

IriSP.ArrowWidget.prototype.clear = function() {

};

IriSP.ArrowWidget.prototype.clearWidget = function() {
};

IriSP.ArrowWidget.prototype.draw = function() {
  var templ = Mustache.to_html(IriSP.arrowWidget_template, {});
  this.selector.append(templ);
  this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.timeUpdateHandler));
  this._Popcorn.listen("IriSP.ArrowWidget.blockArrow", IriSP.wrap(this, this.blockArrow));
  this._Popcorn.listen("IriSP.ArrowWidget.releaseArrow", IriSP.wrap(this, this.releaseArrow));
  
};

IriSP.ArrowWidget.prototype.timeUpdateHandler = function(percents) {
  if (this._blockArrow)
    return;
  
  var currentTime = this._Popcorn.currentTime();
  var currentAnnotation = this._serializer.currentChapitre(currentTime);
  if (IriSP.null_or_undefined(currentAnnotation)) {
    var c_annots = this._serializer.currentAnnotation(currentTime)
    if (c_annots.length != 0)
      var currentAnnotation = c_annots[0]; // FIXME : use the others ?
    else
      return;
  }
  
  /* move the arrow only if the current annotation changes */
  if (currentAnnotation != this._oldAnnotation) {
    var begin = (+ currentAnnotation.begin) / 1000;
    var end = (+ currentAnnotation.end) / 1000;

    var duration = +this._serializer.currentMedia().meta["dc:duration"] / 1000;
    var middle_time = (begin + end) / 2;
    var percents = middle_time / duration;

    // we need to apply a fix because the arrow has a certain length
    // it's half the length of the arrow (27 / 2). We need to convert
    // it in percents though.
    var totalWidth = this.selector.width();    
    var pixels = percents * totalWidth;
    var correction = (27 / 2);
    var corrected_pixels = pixels - correction;
    
    /* make sure that the arrow is aligned with the pattern
       of the widget under it */
    if (corrected_pixels % 3 != 0)
      corrected_pixels -= (corrected_pixels % 3 - 1);
    
    /* don't move out of the screen */
    if (corrected_pixels <= 0)
      corrected_pixels = 0;
    
    if (corrected_pixels <= 15) {
      var left_edge_img_templ = IriSP.templToHTML("url('{{img_dir}}/left_edge_arrow.png')"); 
      this.selector.children(".Ldt-arrowWidget").css("background-image", left_edge_img_templ); 
    } else if (corrected_pixels >= totalWidth - 25) {
      var right_edge_img_templ = IriSP.templToHTML("url('{{img_dir}}/right_edge_arrow.png')"); 
      this.selector.children(".Ldt-arrowWidget").css("background-image", right_edge_img_templ);
    } else {
      var img_templ = IriSP.templToHTML("url('{{img_dir}}/arrow.png')"); 
      this.selector.children(".Ldt-arrowWidget").css("background-image", img_templ);
    }
    
    this.selector.children(".Ldt-arrowWidget").animate({"left" : corrected_pixels + "px"});

    this._oldAnnotation = currentAnnotation;
  }
};

/** Block the arrow for instance when the user is annotating */
IriSP.ArrowWidget.prototype.blockArrow = function() {
  this._blockArrow = true;
};

IriSP.ArrowWidget.prototype.releaseArrow = function() {
  this._blockArrow = false;   
};
IriSP.createAnnotationWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  this._hidden = true;
  this.keywords = IriSP.widgetsDefaults["createAnnotationWidget"].keywords;
  
  this.polemic_mode = IriSP.widgetsDefaults["createAnnotationWidget"].polemic_mode;
  this.polemics = IriSP.widgetsDefaults["createAnnotationWidget"].polemics;
  
  this.cinecast_version = IriSP.widgetsDefaults["createAnnotationWidget"].cinecast_version;
  this.ids = {}; /* a dictionnary linking buttons ids to keywords */
  
  /* variables to save the current position of the slicer */
  if (this.cinecast_version) {
    this.sliceLeft = 0;
    this.sliceWidth = 0;
  }
};


IriSP.createAnnotationWidget.prototype = new IriSP.Widget();

IriSP.createAnnotationWidget.prototype.clear = function() {
    this.selector.find(".Ldt-SaTitle").text("");
    this.selector.find(".Ldt-SaDescription").text("");
    this.selector.find(".Ldt-SaKeywordText").text("");
};

IriSP.createAnnotationWidget.prototype.draw = function() {
  var _this = this;
  var template_params = {cinecast_version: this.cinecast_version, 
                         polemic_mode: this.polemic_mode};
                         
  if (!IriSP.null_or_undefined(IriSP.user) && !IriSP.null_or_undefined(IriSP.user.avatar))
    template_params["user_avatar"] = IriSP.user.avatar;
  
  var annotationMarkup = IriSP.templToHTML(IriSP.createAnnotationWidget_template, 
                                           template_params);
  
	this.selector.append(annotationMarkup);
  
  if (!this.cinecast_version)
    this.selector.hide();
  
  // add the keywords.
  for (var i = 0; i < this.keywords.length; i++) {
    var keyword = this.keywords[i];
    var id = IriSP.guid("button_");
    var templ = IriSP.templToHTML("<button id={{id}} class='Ldt-createAnnotation-absent-keyword'>{{keyword}}</button>", 
                                  {keyword: keyword, id: id});
                                  
    this.ids[keyword] = id; // save it for the function that handle textarea changes.
    
    this.selector.find(".Ldt-createAnnotation-keywords").append(templ);
    this.selector.find("#" + id).click(function(keyword) { return function() {
      var contents = _this.selector.find(".Ldt-createAnnotation-Description").val();
      if (contents.indexOf(keyword) != -1) {
        var newVal = contents.replace(" " + keyword, "");
        if (newVal == contents)
          newVal = contents.replace(keyword, "");
      } else {
        if (contents === "")
          var newVal = keyword;
        else
          var newVal = contents + " " + keyword;      
      }
      
      _this.selector.find(".Ldt-createAnnotation-Description").val(newVal);
      // we use a custom event because there's no simple way to test for a js
      // change in a textfield.
      _this.selector.find(".Ldt-createAnnotation-Description").trigger("js_mod");
      // also call our update function.
      //_this.handleTextChanges();
    }
   }(keyword));
  }

  // add the polemic buttons.
  if(this.polemic_mode)
    for (var polemic in this.polemics) {

      var classname = IriSP.templToHTML("Ldt-createAnnotation-polemic-{{classname}}", {classname : this.polemics[polemic]});

      var templ = IriSP.templToHTML("<button class='{{classname}} Ldt-createAnnotation-polemic-button'>{{polemic}}</button>",
                  {classname: classname, polemic: polemic});
                  
      this.selector.find(".Ldt-createAnnotation-polemics").append(templ);
      this.selector.find("." + classname).click(function(polemic) { return function() {
          var contents = _this.selector.find(".Ldt-createAnnotation-Description").val();
          if (contents.indexOf(polemic) != -1) {
            var newVal = contents.replace(" " + polemic, "");
            if (newVal == contents)
              newVal = contents.replace(polemic, "");
          } else {
            if (contents === "")
              var newVal = polemic;
            else
              var newVal = contents + " " + polemic;      
          }
          
          _this.selector.find(".Ldt-createAnnotation-Description").val(newVal);
          
          // also call our update function.
          _this.handleTextChanges();
        }
       }(polemic));
      }    
  
  // js_mod is a custom event because there's no simple way to test for a js
  // change in a textfield.                    
  this.selector.find(".Ldt-createAnnotation-Description")
               .bind("propertychange keyup input paste js_mod", IriSP.wrap(this, this.handleTextChanges));
               
  /* the cinecast version of the player is supposed to pause when the user clicks on the button */
  if (this.cinecast_version) {
    this.selector.find(".Ldt-createAnnotation-Description")
                 .one("propertychange keyup input paste js_mod", 
                 function() { if (!_this._Popcorn.media.paused) _this._Popcorn.pause() });
  }
  /* the cinecast version expects the user to comment on a defined segment.
     As the widget is always shown, we need a way to update it's content as
     time passes. We do this like we did with the annotationsWidget : we schedule
     a .code start function which will be called at the right time.
  */
  if (this.cinecast_version) {
    var legal_ids;
    if (typeof(this._serializer.getChapitrage()) !== "undefined")
      legal_id = this._serializer.getChapitrage();
    else 
      legal_id = this._serializer.getNonTweetIds()[0];
    
    var annotations = this._serializer._data.annotations;
    var i;
  
    for (i in annotations) {     
      var annotation = annotations[i];
      if (typeof(annotation.meta) !== "undefined" && typeof(annotation.meta["id-ref"]) !== "undefined"
            && legal_id !== annotation.meta["id-ref"]) {
          continue;
      }
      
      code = {start: annotation.begin / 1000, end: annotation.end / 1000,
              onStart: function(annotation) { return function() {
                      if (typeof(annotation.content) !== "undefined")
                        _this.selector.find(".Ldt-createAnnotation-Title").html(annotation.content.title);

                      _this._currentAnnotation = annotation;
                      var beginTime = IriSP.msToTime(annotation.begin);
                      var endTime = IriSP.msToTime(annotation.end);
                      var timeTemplate = IriSP.templToHTML("- ({{begin}} - {{ end }})", {begin: beginTime, end: endTime });
                      _this.selector.find(".Ldt-createAnnotation-TimeFrame").html(timeTemplate);
              } }(annotation)
            };
      
      this._Popcorn.code(code);
    }
  }
  
  this.selector.find(".Ldt-createAnnotation-submitButton").click(IriSP.wrap(this, this.handleButtonClick));
  
  if (!this.cinecast_version) {
    this._Popcorn.listen("IriSP.PlayerWidget.AnnotateButton.clicked", 
                          IriSP.wrap(this, this.handleAnnotateSignal));
    
    // handle clicks on the cancel button too.
    this.selector.find(".Ldt-createAnnotation-Minimize").click(IriSP.wrap(this, 
      function() {
        // we've got to simulate the pressing of the button because there's no
        // other way to minimize the widget and show the widgets that were hidden
        // same time
        this._Popcorn.trigger("IriSP.PlayerWidget.AnnotateButton.clicked");
      }
    ));
  }
};

/** handles clicks on the annotate button. Works only for the non-cinecast version */
IriSP.createAnnotationWidget.prototype.handleAnnotateSignal = function() {
  
  if (this._hidden == false && this._state == 'startScreen') {
    this.selector.hide();
    this._hidden = true;
    
    // free the arrow.
    this._Popcorn.trigger("IriSP.ArrowWidget.releaseArrow");
    this._Popcorn.trigger("IriSP.SliceWidget.hide");
    this._Popcorn.trigger("IriSP.AnnotationsWidget.show");
    
  } else {
    this._Popcorn.trigger("IriSP.AnnotationsWidget.hide");
    this.showStartScreen();
    this.selector.show();
    this._hidden = false;
    var currentTime = this._Popcorn.currentTime();
    
    // block the arrow.
    this._Popcorn.trigger("IriSP.ArrowWidget.blockArrow");
    
    var duration = +this._serializer.currentMedia().meta["dc:duration"];
        
    var currentChapter = this._serializer.currentChapitre(currentTime);

    if (IriSP.null_or_undefined(currentChapter)) {      
      var left = this.selector.width() / 2;
      var width = this.selector.width() / 10;
    } else {
      var left = (currentChapter.begin / duration) * this.selector.width();
      var width = (currentChapter.end / duration) * this.selector.width() - left;
    }
    
    // slider position and length is kept in percents.
    this.sliceLeft = (left / this.selector.width()) * 100;
    this.sliceWidth = (width / this.selector.width()) * 100;
    
    this._Popcorn.trigger("IriSP.SliceWidget.position", [left, width]);
    this._Popcorn.listen("IriSP.SliceWidget.zoneChange", IriSP.wrap(this, this.handleSliderChanges));
    this._Popcorn.trigger("IriSP.SliceWidget.show");
    
    if (!IriSP.null_or_undefined(currentChapter)) {
      this.selector.find(".Ldt-createAnnotation-Title").html(currentChapter.content.title);

      this._currentcurrentChapter = currentChapter;
      var beginTime = IriSP.msToTime(currentChapter.begin);
      var endTime = IriSP.msToTime(currentChapter.end);
      var timeTemplate = IriSP.templToHTML("- ({{begin}} - {{ end }})", {begin: beginTime, end: endTime });
      this.selector.find(".Ldt-createAnnotation-TimeFrame").html(timeTemplate);
    }
  }
};


/** watch for changes in the textfield and change the buttons accordingly */
IriSP.createAnnotationWidget.prototype.handleTextChanges = function(event) {
  var contents = this.selector.find(".Ldt-createAnnotation-Description").val();

  for(var keyword in this.ids) {
  
    var id = this.ids[keyword];

    if (contents.indexOf(keyword) != -1) {
      /* the word is present in the textarea but the button is not toggled */
      if (this.selector.find("#" + id).hasClass("Ldt-createAnnotation-absent-keyword"))
          this.selector.find("#" + id).removeClass("Ldt-createAnnotation-absent-keyword")
                                      .addClass("Ldt-createAnnotation-present-keyword");      
    } else {
      /* the word is absent from the textarea but the button is toggled */
      if (this.selector.find("#" + id).hasClass("Ldt-createAnnotation-present-keyword")) {
          this.selector.find("#" + id).removeClass("Ldt-createAnnotation-present-keyword")
                                      .addClass("Ldt-createAnnotation-absent-keyword");
      }
    }
  }
  
  if (this.polemic_mode) {
    /* Also go through the polemics to highlight the buttons */
    for (var polemic in this.polemics) {
      /* Add the active class to the button */
      var classname = "Ldt-createAnnotation-polemic-" + this.polemics[polemic];
      if (contents.indexOf(polemic) != -1) {        
        this.selector.find("." + classname).addClass("Ldt-createAnnotation-polemic-active");
      } else {
        if (this.selector.find("." + classname).addClass("Ldt-createAnnotation-polemic-active"))
          this.selector.find("." + classname).removeClass("Ldt-createAnnotation-polemic-active")
      }
    }
  }
};

IriSP.createAnnotationWidget.prototype.showStartScreen = function() {
  this.selector.find(".Ldt-createAnnotation-DoubleBorder").children().hide();
  this.selector.find(".Ldt-createAnnotation-startScreen").show();
  this.selector.find(".Ldt-createAnnotation-Description").val("Type your annotation here.");

  this._state = "startScreen";
};

IriSP.createAnnotationWidget.prototype.showWaitScreen = function() {
  this.selector.find(".Ldt-createAnnotation-DoubleBorder").children().hide();
  this.selector.find(".Ldt-createAnnotation-waitScreen").show();
  this._state = "waitScreen";
};

IriSP.createAnnotationWidget.prototype.showErrorScreen = function() {
  this.selector.find(".Ldt-createAnnotation-DoubleBorder").children().hide();
  this.selector.find(".Ldt-createAnnotation-errorScreen").show();
  this._state = "errorScreen";
};

/** update show the final screen with links to share the created annotation */
IriSP.createAnnotationWidget.prototype.showEndScreen = function(annotation) {
  this.selector.find(".Ldt-createAnnotation-DoubleBorder").children().hide();
  
  if (this.cinecast_version) {
    this.selector.find(".Ldt-createAnnotation-Title").parent().show();      
  }

  var url = document.location.href + "#id=" + annotation.id;
  var twStatus = IriSP.mkTweetUrl(url);
  var gpStatus = IriSP.mkGplusUrl(url);
  var fbStatus = IriSP.mkFbUrl(url);
  
  this.selector.find(".Ldt-createAnnotation-endScreen-TweetLink").attr("href", twStatus);
  this.selector.find(".Ldt-createAnnotation-endScreen-FbLink").attr("href", fbStatus);
  this.selector.find(".Ldt-createAnnotation-endScreen-GplusLink").attr("href", gpStatus);
          
  this.selector.find(".Ldt-createAnnotation-endScreen").show();
  this._state = "endScreen";
};

/** handle clicks on "send annotation" button */
IriSP.createAnnotationWidget.prototype.handleButtonClick = function(event) {
  var _this = this;
  var textfield = this.selector.find(".Ldt-createAnnotation-Description");
  var contents = textfield.val();

  if (contents === "") {  
    if (this.selector.find(".Ldt-createAnnotation-errorMessage").length === 0) {
      this.selector.find(".Ldt-createAnnotation-Container")
                   .after(IriSP.templToHTML(IriSP.createAnnotation_errorMessage_template));
      textfield.css("background-color", "#d93c71");      
    } else {      
      this.selector.find(".Ldt-createAnnotation-errorMessage").show();
    }

      textfield.one("js_mod propertychange keyup input paste", IriSP.wrap(this, function() {
                      var contents = textfield.val();
                      
                      if (contents !== "") {
                        this.selector.find(".Ldt-createAnnotation-errorMessage").hide();
                        textfield.css("background-color", "");
                      }
                   }));
  } else {
    this.showWaitScreen();
    
    this.sendLdtData(contents, function(annotation) {
                      if (_this.cinecast_version) {
                          if (_this._Popcorn.media.paused)
                            _this._Popcorn.play();
                      }

                      if (_this._state == "waitScreen") {
                        _this.showEndScreen(annotation);
                        if (_this.cinecast_version) {
                          window.setTimeout(IriSP.wrap(_this, function() { this.showStartScreen(); }), 5000);
                        }
                      }
                      // hide the slicer widget
                      if (!_this.cinecast_version) {                      
                        _this._Popcorn.trigger("IriSP.SliceWidget.hide");
                      }           
                    });
  }
};

IriSP.createAnnotationWidget.prototype.handleSliderChanges = function(params) {
  this.sliceLeft = params[0];
  this.sliceWidth = params[1];
};

IriSP.createAnnotationWidget.prototype.sendLdtData = function(contents, callback) {
  var _this = this;
  var apiJson = {annotations : [{}], meta: {}};
  var annotation = apiJson["annotations"][0];
  
  annotation["media"] = this._serializer.currentMedia()["id"];
  var duration_part = Math.round(this._serializer.currentMedia().meta["dc:duration"] / 20);
  
  if (this.cinecast_version) {   
      annotation["begin"] = Math.round(this._Popcorn.currentTime() * 1000 - duration_part);
      annotation["end"] = Math.round(this._Popcorn.currentTime() * 1000 + duration_part);      
  } else {
    var duration = +this._serializer.currentMedia().meta["dc:duration"];    
    annotation["begin"] = +((duration * (this.sliceLeft / 100)).toFixed(0));
    annotation["end"] = +((duration * ((this.sliceWidth + this.sliceLeft) / 100)).toFixed(0));
  }

  // boundary checks
  if (annotation["begin"] < 0)
        annotation["begin"] = 0;
  
  if (annotation["end"] > this._serializer.currentMedia().meta["dc:duration"])
    annotation["end"] = this._serializer.currentMedia().meta["dc:duration"];
      
  
  annotation["type"] = this._serializer.getContributions();
  if (typeof(annotation["type"]) === "undefined")
    annotation["type"] = "";
  
  annotation["type_title"] = "Contributions";
  annotation.content = {};
  annotation.content["data"] = contents;
  
  var meta = apiJson["meta"];
  if (!IriSP.null_or_undefined(IriSP.user) && !IriSP.null_or_undefined(IriSP.user.name))
    meta.creator = IriSP.user.name;    
  else 
    meta.creator = "An User";
  
  meta.created = Date().toString();
  
  annotation["tags"] = [];
  
  for (var i = 0; i < this.keywords.length; i++) {
    var keyword = this.keywords[i];
    if (contents.indexOf(keyword) != -1)
      annotation["tags"].push(keyword);
  }
  
  var jsonString = JSON.stringify(apiJson);
  var project_id = this._serializer._data.meta.id;
  
  var url = Mustache.to_html("{{platf_url}}/ldtplatform/api/ldt/projects/{{id}}.json",
                              {platf_url: IriSP.platform_url, id: project_id});
                          
  IriSP.jQuery.ajax({
      url: url,
      type: 'PUT',
      contentType: 'application/json',
      data: jsonString,               
      //dataType: 'json',
      success: IriSP.wrap(this, function(json, textStatus, XMLHttpRequest) {                   
                    /* add the annotation to the annotation and tell the world */
                    
                    /* if the media doesn't have a contributions line, we need to add one */
                    if (typeof(this._serializer.getContributions()) === "undefined") {
                      /* set up a basic view */
                      var tmp_view = {"dc:contributor": "perso", "dc:creator": "perso", "dc:title": "Contributions",
                                      "id": json.annotations[0].type}

                      this._serializer._data["annotation-types"].push(tmp_view);
                    }
                    
                    delete annotation.tags;
                    annotation.content.description = annotation.content.data;
                    annotation.content.title = "";
                    delete annotation.content.data;
                    annotation.id = json.annotations[0].id;

                    annotation.meta = meta;
                    annotation.meta["id-ref"] = json.annotations[0]["type"];
                    
                    // everything is shared so there's no need to propagate the change
                    _this._serializer._data.annotations.push(annotation);
 
                    _this._Popcorn.trigger("IriSP.createAnnotationWidget.addedAnnotation", annotation);
                    callback(annotation);
      }), 
      error: 
              function(jqXHR, textStatus, errorThrown) { 
                            console.log("an error occured while contacting " 
                            + url + " and sending " + jsonString + textStatus ); 
                            _this.showErrorScreen(); } });
};IriSP.HelloWorldWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
}

IriSP.HelloWorldWidget.prototype = new IriSP.Widget();

IriSP.HelloWorldWidget.prototype.draw = function() {
    this.selector
        .html('Hello, world')
        .css({
            "text-align" : "center",
            "padding": "10px 0",
            "font-size" : "14px"
        });
        
    console.log(this);
}
IriSP.PlayerWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  
  this._searchBlockOpen = false;
  this._searchLastValue = "";
};

IriSP.PlayerWidget.prototype = new IriSP.Widget();

IriSP.PlayerWidget.prototype.draw = function() {
  var self = this;
  var width = this.width;
	var height = this.height;
	var heightS = this.height-20;
	  
	var playerTempl = IriSP.templToHTML(IriSP.player_template, {"share_template" : IriSP.share_template});
  this.selector.append(playerTempl);		
	
  this.selector.children(".Ldt-controler").show();
    
  // handle clicks by the user on the video.
  this._Popcorn.listen("play", IriSP.wrap(this, this.playButtonUpdater));
  this._Popcorn.listen("pause", IriSP.wrap(this, this.playButtonUpdater));
  
  this._Popcorn.listen("volumechange", IriSP.wrap(this, this.muteButtonUpdater));

  this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.timeDisplayUpdater));  
  // update the time display for the first time.
  this._Popcorn.listen("loadedmetadata", IriSP.wrap(this, this.timeDisplayUpdater));
  
  this._Popcorn.listen("IriSP.search.matchFound", IriSP.wrap(this, this.searchMatch));
  this._Popcorn.listen("IriSP.search.noMatchFound", IriSP.wrap(this, this.searchNoMatch));
  this._Popcorn.listen("IriSP.search.triggeredSearch", IriSP.wrap(this, this.triggeredSearch));
  
  
  this.selector.find(".Ldt-CtrlPlay").click(function() { self.playHandler.call(self); });
  this.selector.find(".Ldt-CtrlAnnotate").click(function() 
                                            { self._Popcorn.trigger("IriSP.PlayerWidget.AnnotateButton.clicked"); });
  this.selector.find(".Ldt-CtrlSearch").click(function() { self.searchButtonHandler.call(self); });
  
  this.selector.find('.Ldt-CtrlSound').click(function() { self.muteHandler.call(self); } );

  this.selector.find(".Ldt-CtrlPlay").attr( "style", "background-color:#CD21C24;" );
  
  /*
  var searchButtonPos = this.selector.find(".Ldt-CtrlSearch").position();
  var searchBox = Mustache.to_html(IriSP.search_template, {margin_left : searchButtonPos.left + "px"});
  this.selector.find(".Ldt-CtrlSearch").after(searchBox);
  */
  
  // trigger an IriSP.PlayerWidget.MouseOver to the widgets that are interested (i.e : sliderWidget)
  this.selector.hover(function() { self._Popcorn.trigger("IriSP.PlayerWidget.MouseOver"); }, 
                      function() { self._Popcorn.trigger("IriSP.PlayerWidget.MouseOut"); });
 
  this.muteButtonUpdater(); /* some player - jwplayer notable - save the state of the mute button between sessions */
};

/* Update the elasped time div */
IriSP.PlayerWidget.prototype.timeDisplayUpdater = function() {
  
  if (this._previousSecond === undefined)
    this._previousSecond = this._Popcorn.roundTime();
  
  else {
    /* we're still in the same second, so it's not necessary to update time */
    if (this._Popcorn.roundTime() == this._previousSecond)
      return;
      
  }
  
  // we get it at each call because it may change.
  var duration = +this._serializer.currentMedia().meta["dc:duration"] / 1000; 
  var totalTime = IriSP.secondsToTime(duration);
  var elapsedTime = IriSP.secondsToTime(this._Popcorn.currentTime());
  
  this.selector.find(".Ldt-ElapsedTime").html(elapsedTime.toString());
  this.selector.find(".Ldt-TotalTime").html(totalTime.toString());
  this._previousSecond = this._Popcorn.roundTime();
};

/* update the icon of the button - separate function from playHandler
   because in some cases (for instance, when the user directly clicks on
   the jwplayer window) we have to change the icon without playing/pausing
*/
IriSP.PlayerWidget.prototype.playButtonUpdater = function() {
  var status = this._Popcorn.media.paused;
  
  if ( status == true ){        
    this.selector.find(".Ldt-CtrlPlay").attr("title", "Play");
   
    // we use templToHTML because it has some predefined
    // vars like where to get the images
    var templ = IriSP.templToHTML("url({{img_dir}}/play_sprite.png)");
    this.selector.find(".Ldt-CtrlPlay").css("background-image", templ);

  } else {
    this.selector.find(".Ldt-CtrlPlay").attr("title", "Pause");

    // we use templToHTML because it has some predefined
    // vars like where to get the images
    var templ = IriSP.templToHTML("url({{img_dir}}/pause_sprite.png)");
    this.selector.find(".Ldt-CtrlPlay").css("background-image", templ);
  }  

  return;
};


IriSP.PlayerWidget.prototype.playHandler = function() {
  var status = this._Popcorn.media.paused;
  
  if ( status == true ){        
    this._Popcorn.play();   
  } else {
    this._Popcorn.pause();
  }  
};

IriSP.PlayerWidget.prototype.muteHandler = function() {
  if (!this._Popcorn.muted()) {    
      this._Popcorn.mute(true);
    } else {
      this._Popcorn.mute(false);
    }
};

IriSP.PlayerWidget.prototype.muteButtonUpdater = function() {
  var status = this._Popcorn.media.muted;
  
  if ( status == true ){        
    this.selector.find(".Ldt-CtrlSound").attr("title", "Unmute");
   
    // we use templToHTML because it has some predefined
    // vars like where to get the images
    var templ = IriSP.templToHTML("url({{img_dir}}/sound_sprite.png)");
    this.selector.find(".Ldt-CtrlSound").css("background-image", templ);

  } else {
    this.selector.find(".Ldt-CtrlSound").attr("title", "Mute");

    // we use templToHTML because it has some predefined
    // vars like where to get the images
    var templ = IriSP.templToHTML("url({{img_dir}}/mute_sprite.png)");
    this.selector.find(".Ldt-CtrlSound").css("background-image", templ);
  }  

  return;
};

IriSP.PlayerWidget.prototype.showSearchBlock = function() {
  var self = this;
  
  if (this._searchBlockOpen == false) {
    this.selector.find(".LdtSearch").show("blind", { direction: "horizontal"}, 100);
    this.selector.find(".LdtSearchInput").css('background-color','#fff');
   
    this._searchBlockOpen = true;           
    this.selector.find(".LdtSearchInput").bind('keyup', null, function() { self.searchHandler.call(self); } );
    this.selector.find(".LdtSearchInput").focus();
    
    // we need this variable because some widget can find a match in
    // their data while at the same time other's don't. As we want the
    // search field to become green when there's a match, we need a 
    // variable to remember that we had one.
    this._positiveMatch = false;

    // tell the world the field is open
    this._Popcorn.trigger("IriSP.search.open");     
	}
};

IriSP.PlayerWidget.prototype.hideSearchBlock = function() {
 if (this._searchBlockOpen == true) {
    this._searchLastValue = this.selector.find(".LdtSearchInput").attr('value');
    this.selector.find(".LdtSearchInput").attr('value','');
    this.selector.find(".LdtSearch").hide("blind", { direction: "horizontal"}, 75);
    
    // unbind the watcher event.
    this.selector.find(".LdtSearchInput").unbind('keypress set');
    this._searchBlockOpen = false;

    this._positiveMatch = false;
    
    this._Popcorn.trigger("IriSP.search.closed");
	}
};

/** react to clicks on the search button */
IriSP.PlayerWidget.prototype.searchButtonHandler = function() {
  var self = this;

  /* show the search field if it is not shown */
  if ( this._searchBlockOpen == false ) {
    this.showSearchBlock();
    this.selector.find(".LdtSearchInput").attr('value', this._searchLastValue);      
    this._Popcorn.trigger("IriSP.search", this._searchLastValue); // trigger the search to make it more natural.
	} else {
    this.hideSearchBlock();
  }
};

/** this handler is called whenever the content of the search
   field changes */
IriSP.PlayerWidget.prototype.searchHandler = function() {
  this._searchLastValue = this.selector.find(".LdtSearchInput").attr('value');
  this._positiveMatch = false;
  
  // do nothing if the search field is empty, instead of highlighting everything.
  if (this._searchLastValue == "") {
    this._Popcorn.trigger("IriSP.search.cleared");
    this.selector.find(".LdtSearchInput").css('background-color','');
  } else {
    this._Popcorn.trigger("IriSP.search", this._searchLastValue);
  }
};

/**
  handler for the IriSP.search.found message, which is sent by some views when they
  highlight a match.
*/
IriSP.PlayerWidget.prototype.searchMatch = function() {
  this._positiveMatch = true;
  this.selector.find(".LdtSearchInput").css('background-color','#e1ffe1');
};

/** the same, except that no value could be found */
IriSP.PlayerWidget.prototype.searchNoMatch = function() {
  if (this._positiveMatch !== true)
    this.selector.find(".LdtSearchInput").css('background-color', "#d62e3a");
};

/** react to an IriSP.Player.triggeredSearch - that is, when
    a widget ask the PlayerWidget to do a search on his behalf */
IriSP.PlayerWidget.prototype.triggeredSearch = function(searchString) {
  this.showSearchBlock();
  this.selector.find(".LdtSearchInput").attr('value', searchString);      
  this._Popcorn.trigger("IriSP.search", searchString); // trigger the search to make it more natural.
};


/* 
 *   
 *  Copyright 2010 Institut de recherche et d'innovation 
 *  contributor(s) : Samuel Huron 
 *   
 *  contact@iri.centrepompidou.fr
 *  http://www.iri.centrepompidou.fr 
 *   
 *  This software is a computer program whose purpose is to show and add annotations on a video .
 *  This software is governed by the CeCILL-C license under French law and
 *  abiding by the rules of distribution of free software. You can  use, 
 *  modify and/ or redistribute the software under the terms of the CeCILL-C
 *  license as circulated by CEA, CNRS and INRIA at the following URL
 *  "http://www.cecill.info". 
 *  
 *  The fact that you are presently reading this means that you have had
 *  knowledge of the CeCILL-C license and that you accept its terms.
*/
// CHART TIMELINE / VERSION PROTOTYPE  ::

/** the polemic widget */
IriSP.PolemicWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
 
  this.userPol    = new Array();
  this.userNoPol  = new Array();
  this.userst      = new Array();
  this.numberOfTweet = 0;
  this.Users;
  this.TweetPolemic;
  this.yMax        = this.height; 
  this.PaperSlider;
  this.heightOfChart;
  this.tweets  = new Array();
  this.svgElements = {};
  
  this.oldSearchMatches = [];
};

IriSP.PolemicWidget.prototype = new IriSP.Widget();
  
IriSP.PolemicWidget.prototype.draw = function() {
  
    // variable 
    // yMax
    
    var self = this;
    var yCoef        = 2;             // coef for height of 1 tweet 
    var frameSize     = 5;             // frame size 
    var margin         = 1;            // marge between frame
    var lineSize      = this.width;        // timeline pixel width 
    var nbrframes     = lineSize/frameSize;     // frame numbers
    var numberOfTweet   = 0;            // number of tweet overide later 
    var duration      = +this._serializer.currentMedia().meta["dc:duration"];      // timescale width 
    var frameLength   = lineSize / frameSize;    // frame timescale  
    var timeline;
    var colors  = new Array("","#1D973D","#C5A62D","#CE0A15","#036AAE","#585858");
    
    // array 
    //var tweets  = new Array();
    var element = new Array();
    var cluster = new Array();
    var frames  = new Array(frameLength);
    var slices  = new Array();
    
    
    // Classes =======================================================================
    var Frames = function(){
      
      var Myclusters;
      var x;
      var y;
      var width;
      var height;
    };
    Frames = function(json){
      // make my clusters
      // ou Frame vide 
    };
    Frames.prototype.draw = function(){
    };
    Frames.prototype.zoom = function(){
    };
    Frames.prototype.inside = function(){
    };
    var Clusters = function(){
      var Object;
      var yDist;
      var x;
      var y;
      var width;
      var height;
    };
    Clusters = function(json){
      // make my object
    };
    var Tweet = function(){
    };
    // Classes =======================================================================

    // Refactoring (parametere) ************************************************************
    // color translastion
    var qTweet_0  =0;
    var qTweet_Q  =0;
    var qTweet_REF=0;
    var qTweet_OK =0;
    var qTweet_KO =0;
    function colorTranslation(value){
      if(value == "Q"){
        qTweet_Q+=1;
        return 2;
      }else if(value =="REF"){
        qTweet_REF+=1;
        return 4;
      }else if(value =="OK"){
        qTweet_OK+=1;
        return 1;
      }else if(value =="KO"){
        qTweet_KO+=1;
        return 3;
      }else if(value ==""){
        qTweet_0+=1;
        return 5;
      }
    }
    

      this._serializer.sync(function(data) { loaded_callback.call(self, data); return; });
      
      function loaded_callback (json) {
      var view_type = this._serializer.getTweets();

      
      if (typeof(view_type) === "undefined") {
        var view_type = this._serializer.getTweetIds()[0];
        if (typeof(view_type) === "undefined") {
          // default to guessing if nothing else works.
          var view = json.views[0];
          
          if(typeof(view.annotation_types) !== "undefined") {
            /* we need to be backward compatible with the old files which used to
               feature only two lines : Chapitrage and Tweets. We've added a
               "Contributions" line so we need to discriminate against that */
            if (view.annotation_types.length === 2 && typeof(this._serializer.getContributions()) === "undefined") {
              var view_type = view.annotation_types[1];
            } else {
              console.log("PolemicWidget: invalid file - minimizing");
              return;
            }
          }      
        }
      }
      
      // Make and define the Raphael area
      this.paper = Raphael(document.getElementById(this._id), this._config.width, this._config.height);
      
      // event handlers
      this._Popcorn.listen("IriSP.search", IriSP.wrap(this, function(searchString) { this.searchHandler(searchString); }));
      this._Popcorn.listen("IriSP.search.closed", IriSP.wrap(this, this.searchFieldClosedHandler));
      this._Popcorn.listen("IriSP.search.cleared", IriSP.wrap(this, this.searchFieldClearedHandler));
      this.selector.mouseleave(IriSP.wrap(this, function() { self.TooltipWidget.hide.call(self.TooltipWidget); }));
      this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.sliderUpdater));
      this._Popcorn.listen("IriSP.Mediafragment.showAnnotation", IriSP.wrap(this, this.showAnnotation));
      
      for(var i = 0; i < json.annotations.length; i++) {
        var item = json.annotations[i];        
        var MyTime  = Math.floor(item.begin/duration*lineSize);
        var Myframe = Math.floor(MyTime/lineSize*frameLength);

        if (typeof(item.meta) !== "undefined" 
          && typeof(item.meta["id-ref"]) !== "undefined"
          && item.meta["id-ref"] === view_type) {
            
            var MyTJson = {};
            if (typeof(item.meta['dc:source']) !== "undefined") {
              var MyTJson = JSON.parse(item.meta['dc:source']['content']);
            }
            
            if (item.content['polemics'] != undefined 
            && item.content['polemics'][0] != null) {
            
              // a tweet can have many polemics at the same time.
              for(var j=0; j<item.content['polemics'].length; j++){
                  
                  this.tweets[numberOfTweet] = {
                        id:i,
                        qualification:colorTranslation(item.content['polemics'][j]),
                        yIndicator:MyTime,
                        yframe:Myframe,
                        title:item.content['title'],
                        timeframe:item.begin,
                        userId: MyTJson.id,
                        userScreenName: MyTJson.screen_name,
                        tsource:MyTJson,
                        cinecast_id: item.id
                        };
                  numberOfTweet+=1;
                  
              }
          }
          else {
            this.tweets[numberOfTweet] = {
                  id:i,
                  qualification:colorTranslation(""),
                  yIndicator:MyTime,
                  yframe:Myframe,
                  title:item.content['title'],
                  timeframe:item.begin,
                  userId: MyTJson.id,
                  userScreenName: MyTJson.screen_name,
                  tsource:MyTJson,
                  cinecast_id: item.id
            };
            numberOfTweet+=1;
          }
          
        } 
      };  
      
       DrawTweets.call (this); // FIXME: ugly.
       
      };      

    // tweet Drawing (in raphael) 
    function DrawTweets (){
    // GROUPES TWEET ============================================
    // Count nbr of cluster and tweet in a frame an save int in "frames"
      numberOfTweet = this.tweets.length;
      for(var i=0; i<nbrframes; i++) {  
        for(var j=0; j<numberOfTweet; j++) {  
        
          if (i==this.tweets[j].yframe){
            
            var k = this.tweets[j].qualification;
            
            // make array for frame cluster
            if(frames[i]==undefined){
              frames[i] = {id:i,
                     qualifVol:new Array(),
                     mytweetsID:new Array()
                    };
            }
            // add my tweet to frame
            frames[i].mytweetsID.push(this.tweets[j]);
            
            // count opinion by frame
            if( frames[i].qualifVol[k] == undefined){
              frames[i].qualifVol[k] = 1;
            }else{
              frames[i].qualifVol[k] += 1;
            }
            
          }
        }
      }
    
    // GROUPES TWEET ============================================    
    // max of tweet by Frame 
      var max = 0; 
      for(var i = 0; i < nbrframes; i++) {
        var moy  = 0;
        for (var j = 0; j < 6; j++) {    
          if (frames[i] != undefined) {
            if (frames[i].qualifVol[j] != undefined) {
              moy += frames[i].qualifVol[j];
            }
          }
        }
        
        if (moy > max) {
          max = moy;
        }
      }
    
      var tweetDrawed = new Array();
      var TweetHeight = 5;
      var newHeight = TweetHeight * max + 10;

      
      if (newHeight > this.height) {
        this.paper.setSize(this.width, newHeight);
        this.height = newHeight;
        console.log("resizeing");
      }
      
  
      // DRAW  TWEETS ============================================
      for(var i = 0; i < nbrframes; i++) {
        var addEheight = 5;
        if (frames[i] != undefined){                
          // by type 
          
          for (var j = 6; j > -1; j--) {
            if (frames[i].qualifVol[j] != undefined) {
              // show tweet by type 
              for (var k = 0; k < frames[i].mytweetsID.length; k++) {
              
                if (frames[i].mytweetsID[k].qualification == j) {                
                  var x = i * frameSize;
                  var y = this.height - addEheight;
                  
                  if (this.yMax > y) {
                    this.yMax = y;
                  }
                  
                  /* some tweets seem to be duplicated - so we make a check before
                     creating a new rect */
                  if (this.svgElements.hasOwnProperty(frames[i].mytweetsID[k].cinecast_id))
                    continue;
                  
                  var e = this.paper.rect(x, y, frameSize - margin, TweetHeight /* height */)
                                    .attr({stroke:"#00","stroke-width":0.1,  fill: colors[j]});  
                  
                  addEheight += TweetHeight;
                  
                  /* stick a lot of things into e because that's the easiest way
                     to do it */
                  e.color = colors[j];
                  e.time = frames[i].mytweetsID[k].timeframe;
                  e.title = frames[i].mytweetsID[k].title;
                  e.id = frames[i].mytweetsID[k].cinecast_id;
                  var pos = IriSP.jQuery(e.node).offset();                  
                  e.x = pos.left;
                  e.y = pos.top;
                  this.svgElements[e.id] = e;
                  
                  IriSP.jQuery(e.node).mouseenter(function(element) { return function (event) {                        
                        // event.clientX and event.clientY are to raphael what event.pageX and pageY are to jquery.                        
                        self.TooltipWidget.show.call(self.TooltipWidget, element.title, element.attr("fill"), event.pageX - 106, event.pageY - 160);
                        element.displayed = true;
                  }}(e)).mousedown(function(element) { return function () {                    
                    self._Popcorn.currentTime(element.time/1000);
                    self._Popcorn.trigger("IriSP.PolemicTweet.click", element.id); 
                    }
                  }(e));                  
                  
                  IriSP.jQuery(e.node).attr('id', 't' + k + '');
                  IriSP.jQuery(e.node).attr('title', frames[i].mytweetsID[k].title);
                  IriSP.jQuery(e.node).attr('begin',  frames[i].mytweetsID[k].timeframe);                  
                }
              }
            }
          }
        }

      }    
      // DRAW UI :: resize border and bgd      
      this.paperBackground = this.paper.rect(0, 0, this.width, this.height).attr({fill:"#F8F8F8","stroke-width":0.1,opacity: 1});  

      // outer borders
      this.outerBorders   = [];
      this.outerBorders.push(this.paper.rect(0, this.height - 1, this.width, 1).attr({fill:"#ababab",stroke: "none",opacity: 1}));  
      this.outerBorders.push(this.paper.rect(0, 0, this.width, 1).attr({fill:"#ababab",stroke: "none",opacity: 1}));  

      // inner borders
      this.innerBorders   = [];
      this.innerBorders.push(this.paper.rect(1, this.height - 2, this.width, 1).attr({fill:"#efefef",stroke: "none",opacity: 1}));  
      this.innerBorders.push(this.paper.rect(1, 1, this.width, 1).attr({fill:"#efefef",stroke: "none",opacity: 1}));  
      this.innerBorders.push(this.paper.rect(1, 1, 1, this.height - 2).attr({fill:"#d0d1d1",stroke: "none",opacity: 0.8}));  
      this.innerBorders.push(this.paper.rect(this.width - 2, 1, 1, this.height - 2).attr({fill:"#efefef",stroke: "none",opacity: 1}));  



      this.paperSlider   = this.paper.rect(0, 0, 0, this.height).attr({fill:"#D4D5D5", stroke: "none", opacity: 1});
      
      // the small white line displayed over the slider.
      this.sliderTip = this.paper.rect(0, 0, 1, this.height).attr({fill:"#fc00ff", stroke: "none", opacity: 1});
      // decalage 
      // tweetSelection = this.paper.rect(-100,-100,5,5).attr({fill:"#fff",stroke: "none",opacity: 1});  
      
      
      this.paperSlider.toBack();
      this.paperBackground.toBack();
      this.sliderTip.toFront();
    }
    

}

/** update the positionMarker as time passes */
IriSP.PolemicWidget.prototype.sliderUpdater = function() {

    var time = +this._Popcorn.currentTime();
    var duration = +this._serializer.currentMedia().meta["dc:duration"];
    
    this.paperSlider.attr("width", time * (this.width / (duration / 1000)));
        
    this.sliderTip.attr("x", time * (this.width / (duration / 1000)));
};

/** reacts to IriSP.search events */    
IriSP.PolemicWidget.prototype.searchHandler = function(searchString) {
  if (searchString == "")
    return;

  var matches = this._serializer.searchTweetsOccurences(searchString);

  if (IriSP.countProperties(matches) > 0) {
    this._Popcorn.trigger("IriSP.search.matchFound");
  } else {
    this._Popcorn.trigger("IriSP.search.noMatchFound");
  }

  
  // decrease the opacity of the other elements.
  for (var id in this.svgElements) {
    var e = this.svgElements[id];
    e.attr({fill: e.color, opacity: 0.4});   
  }
  

  for (var id in matches) {    
    if (this.svgElements.hasOwnProperty(id)) {
      var e = this.svgElements[id];
      this.svgElements[id].attr({fill: "#fc00ff", opacity: 1});
    }
  }

  this.oldSearchMatches = matches;
};

/** reacts to IriSP.search.cleared messages */
IriSP.PolemicWidget.prototype.searchFieldClearedHandler = function() {
  for (var id in this.svgElements) {
    var e = this.svgElements[id];
    e.attr({fill: e.color, opacity: 1});
  }
};

/** reacts to IriSP.search.closed messages by clearing the highlighted elements */
IriSP.PolemicWidget.prototype.searchFieldClosedHandler = function() {
  for (var id in this.svgElements) {
    var e = this.svgElements[id];
    e.attr({fill: e.color, opacity: 1});
  }
 
};
   
IriSP.PolemicWidget.prototype.showAnnotation = function(id) {
  if (this.svgElements.hasOwnProperty(id)) {
    var e = this.svgElements[id];
    this.TooltipWidget.show(e.title, e.attr("fill"), e.x - 103, e.y - 160);
  }
};   
IriSP.SegmentsWidget = function(Popcorn, config, Serializer) {

  var self = this;
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  this.oldSearchMatches = [];

  // event handlers
  this._Popcorn.listen("IriSP.search", function(searchString) { self.searchHandler.call(self, searchString); });
  this._Popcorn.listen("IriSP.search.closed", function() { self.searchFieldClosedHandler.call(self); });
  this._Popcorn.listen("IriSP.search.cleared", function() { self.searchFieldClearedHandler.call(self); });
};

IriSP.SegmentsWidget.prototype = new IriSP.Widget();

/* Get the width of a segment, in pixels. */
IriSP.SegmentsWidget.prototype.segmentToPixel = function(annotation) {  
  var begin = Math.round((+ annotation.begin) / 1000);
  var end = Math.round((+ annotation.end) / 1000);    
  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  
  var startPourcent 	= IriSP.timeToPourcent(begin, duration);
  var startPixel = Math.floor(this.selector.parent().width() * (startPourcent / 100));
  
  var endPourcent 	= Math.floor(IriSP.timeToPourcent(end, duration) - startPourcent);
  var endPixel = Math.floor(this.selector.parent().width() * (endPourcent / 100));
  
  return endPixel;
};

/* compute the total length of a group of segments */
IriSP.SegmentsWidget.prototype.segmentsLength = function(segmentsList) {
  var self = this;
  var total = 0;
  
  for (var i = 0; i < segmentsList.length; i++)
    total += self.segmentToPixel(segmentsList[i].annotation);
  
  return total;  
};

IriSP.SegmentsWidget.prototype.draw = function() {

  var self = this;
  var annotations = this._serializer._data.annotations;

  this.selector.addClass("Ldt-SegmentsWidget");
  this.selector.append(Mustache.to_html(IriSP.overlay_marker_template));
          
  var view_type = this._serializer.getChapitrage();
  if (typeof(view_type) === "undefined") {
    view_type = this._serializer.getNonTweetIds()[0];  
  }
  this.positionMarker = this.selector.children(":first");
  
  this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.positionUpdater));

  
  var i = 0;
  
  var segments_annotations = [];
  
  for (i = 0; i < annotations.length; i++) {
    var annotation = annotations[i];

    /* filter the annotations whose type is not the one we want */
    if (view_type != "" && typeof(annotation.meta) !== "undefined" && typeof(annotation.meta["id-ref"]) !== "undefined"
          && annotation.meta["id-ref"] != view_type) {
        continue;
    }

    segments_annotations.push(annotation);
  }
    
  var totalWidth = this.selector.width() - segments_annotations.length;
  var lastSegment = IriSP.underscore.max(segments_annotations, function(annotation) { return annotation.end; });
  
  for (i = 0; i < segments_annotations.length; i++) {
  
    var annotation = segments_annotations[i];
    var begin = (+ annotation.begin);
    var end = (+ annotation.end);
    var duration = this._serializer.currentMedia().meta["dc:duration"];
    var id = annotation.id;
        
    var startPixel = Math.floor(this.selector.parent().width() * (begin / duration));

    var endPixel = Math.floor(this.selector.parent().width() * (end / duration));
    
    if (annotation.id !== lastSegment.id) 
      var pxWidth = endPixel - startPixel -1;
    else
      /* the last segment has no segment following it */
      var pxWidth = endPixel - startPixel;
 
    var divTitle = IriSP.clean_substr(annotation.content.title + " -<br>" + annotation.content.description, 0, 132) + "...";

    if (typeof(annotation.content.color) !== "undefined")
      var color = annotation.content.color;
    else
      var color = annotation.color;
    
    var hexa_color = IriSP.DEC_HEXA_COLOR(color);

    /*
    if (hexa_color === "FFCC00")
      hexa_color = "333";
    */
    if (hexa_color.length == 4)
      hexa_color = hexa_color + '00';
    
    var annotationTemplate = Mustache.to_html(IriSP.annotation_template,
        {"divTitle" : divTitle, "id" : id, "startPixel" : startPixel,
        "pxWidth" : pxWidth, "hexa_color" : hexa_color,
        "seekPlace" : Math.round(begin/1000)});

        
    this.selector.append(annotationTemplate);
    
    /* add a special class to the last segment and change its border */
    if (annotation.id === lastSegment.id) {
        this.selector.find("#" + id).addClass("Ldt-lastSegment");        
        this.selector.find(".Ldt-lastSegment").css("border-color", "#" + hexa_color);        
    }

    IriSP.jQuery("#" + id).fadeTo(0, 0.3);

    IriSP.jQuery("#" + id).mouseover(
    /* we wrap the handler in another function because js's scoping
       rules are function-based - otherwise, the internal vars like
       divTitle are preserved but they are looked-up from the draw
       method scope, so after that the loop is run, so they're not
       preserved */
    (function(divTitle) { 
     return function(event) {
          IriSP.jQuery(this).animate({opacity: 0.6}, 5);
          var offset = IriSP.jQuery(this).offset();
          var correction = IriSP.jQuery(this).outerWidth() / 2;

          var offset_x = offset.left + correction - 106;
          if (offset_x < 0)
            offset_x = 0;
          
          var offset_y = offset.top;          

          self.TooltipWidget.show(divTitle, color, offset_x, offset_y - 160);
    } })(divTitle)).mouseout(function(){
      IriSP.jQuery(this).animate({opacity: 0.3}, 5);
      self.TooltipWidget.hide();
    });

    // react to mediafragment messages.
    this._Popcorn.listen("IriSP.Mediafragment.showAnnotation", 
      function(id, divTitle) { 
      return function(annotation_id) { 
        if (annotation_id !== id)
          return;
        
          var divObject = IriSP.jQuery("#" + id);
          divObject.animate({opacity: 0.6}, 5);
          var offset = divObject.offset();
          var correction = divObject.outerWidth() / 2;

          var offset_x = offset.left + correction - 106;
          if (offset_x < 0)
            offset_x = 0;
          
          var offset_y = offset.top;          

          self.TooltipWidget.show(divTitle, color, offset_x, offset_y - 160);
          IriSP.jQuery(document).one("mousemove", function() { divObject.animate({opacity: 0.3}, 5);
                                                                self.TooltipWidget.hide(); });
      }; }(id, divTitle));
    
    IriSP.jQuery("#" + id).click(function(_this, annotation) {
                                    return function() { _this.clickHandler(annotation)};
                                 }(this, annotation));
    }
};

/* restores the view after a search */
IriSP.SegmentsWidget.prototype.clear = function() {
  this.selector.children(".Ldt-iri-chapter").animate({opacity:0.3}, 100);
};

IriSP.SegmentsWidget.prototype.clickHandler = function(annotation) {
  this._Popcorn.trigger("IriSP.SegmentsWidget.click", annotation.id);
  var begin = (+ annotation.begin) / 1000;
  this._Popcorn.currentTime(Math.round(begin));
};

IriSP.SegmentsWidget.prototype.searchHandler = function(searchString) {

  if (searchString == "")
    return;

  var matches = this._serializer.searchOccurences(searchString);

  if (IriSP.countProperties(matches) > 0) {
    this._Popcorn.trigger("IriSP.search.matchFound");
  } else {
    this._Popcorn.trigger("IriSP.search.noMatchFound");
  }

  // un-highlight all the blocks
  this.selector.children(".Ldt-iri-chapter").css("opacity", 0.1);
 
  // then highlight the ones with matches.
  for (var id in matches) {
    var factor = 0.5 + matches[id] * 0.2;
    this.selector.find("#"+id).dequeue();
    this.selector.find("#"+id).animate({opacity:factor}, 200);
  }

 
  this.oldSearchMatches = matches;
};

IriSP.SegmentsWidget.prototype.searchFieldClearedHandler = function() {
  this.clear();
};

IriSP.SegmentsWidget.prototype.searchFieldClosedHandler = function() {
  this.clear();
};

IriSP.SegmentsWidget.prototype.positionUpdater = function() {  
  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var time = this._Popcorn.currentTime();
  //var position 	= ((time / duration) * 100).toFixed(2);
  var position 	= ((time / duration) * 100).toFixed(2);

  this.positionMarker.css("left", position + "%");  
};

IriSP.SegmentsWidget.prototype.showAnnotation = function() {

};
/** A widget to create a new segment */
IriSP.SliceWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  
};

IriSP.SliceWidget.prototype = new IriSP.Widget();

IriSP.SliceWidget.prototype.draw = function() {
  var templ = Mustache.to_html(IriSP.sliceWidget_template);
  this.selector.append(templ);
  
  this.sliceZone = this.selector.find(".Ldt-sliceZone");
  
  /* global variables used to keep the position and width
     of the zone.
  */  
  this.zoneLeft = 0;
  this.zoneWidth = 0;
  
  this.leftHandle = this.selector.find(".Ldt-sliceLeftHandle");
  this.rightHandle = this.selector.find(".Ldt-sliceRightHandle");

  var left = this.selector.offset().left;
  var top = this.selector.offset().top;

  // a bug in firefox makes it use the wrong format
  if (!IriSP.jQuery.browser.mozilla) {
    // contain the handles correctly - we cannot set
    // containment: parent because it wouldn't allow to select the 
    // whole slice, so we have to compute a box in which the slice is
    // allowed to move.
    var containment = [left - 8, top, this.selector.width() + left, top];

    // var containment = [left - 16, top, this.selector.width() + left - 8, top];
    this.leftHandle.draggable({axis: "x",
    drag: IriSP.wrap(this, this.leftHandleDragged),  
    containment: containment
    });

    containment = [left, top, this.selector.width() + left, top];
    // containment = [left, top, this.selector.width() + left - 8, top];
    this.rightHandle.draggable({axis: "x",
    drag: IriSP.wrap(this, this.rightHandleDragged),    
    containment: containment
    });
  
  } else { // firefox
    // we need to define a containment specific to firefox.
    
    var containment = [left - 16, top, this.selector.width() + left - 8, top];
    this.leftHandle.draggable({axis: "x",
    drag: IriSP.wrap(this, this.leftHandleDragged),  
    containment: containment
    });

    containment = [left, top, this.selector.width() + left - 8, top];
    this.rightHandle.draggable({axis: "x",
    drag: IriSP.wrap(this, this.rightHandleDragged),    
    containment: containment
    });
  }
  
  this.leftHandle.css("position", "absolute");
  this.rightHandle.css("position", "absolute");
  
  this._Popcorn.listen("IriSP.SliceWidget.position", 
                        IriSP.wrap(this, this.positionSliceHandler));
  
  this._Popcorn.listen("IriSP.SliceWidget.show", IriSP.wrap(this, this.show));
  this._Popcorn.listen("IriSP.SliceWidget.hide", IriSP.wrap(this, this.hide));
  this.selector.hide();
};

/** responds to an "IriSP.SliceWidget.position" message
    @param params an array with the first element being the left distance in
           percents and the second element the width of the slice in pixels
*/        
IriSP.SliceWidget.prototype.positionSliceHandler = function(params) {
  left = params[0];
  width = params[1];
  
  this.zoneLeft = left;
  this.zoneWidth = width;
  this.sliceZone.css("left", left + "px");
  this.sliceZone.css("width", width + "px");
  this.leftHandle.css("left", (left - 7) + "px");
  this.rightHandle.css("left", left + width + "px");
  
  this._leftHandleOldLeft = left - 7;
  this._rightHandleOldLeft = left + width;
};

/** handle a dragging of the left handle */
IriSP.SliceWidget.prototype.leftHandleDragged = function(event, ui) {
  /* we have a special variable, this._leftHandleOldLeft, to keep the
     previous position of the handle. We do that to know in what direction
     is the handle being dragged
  */
  
  var currentX = this.leftHandle.offset().left;
  var rightHandleX = Math.floor(this.rightHandle.position()["left"]);
  
  var container_offset = this.selector.offset().left;

  if (Math.floor(ui.position.left) >= rightHandleX - 7) {
    /* prevent the handle from moving past the right handle */
    ui.position.left = rightHandleX - 7;
  }

  this.zoneWidth = rightHandleX - Math.floor(ui.position.left) - 7;  
  this.zoneLeft = Math.floor(ui.position.left) + 8;
  
  this.sliceZone.css("width", this.zoneWidth);
  this.sliceZone.css("left", this.zoneLeft + "px");
  
  this._leftHandleOldLeft = ui.position.left;  
  this.broadcastChanges();
    
};

/** handle a dragging of the right handle */
IriSP.SliceWidget.prototype.rightHandleDragged = function(event, ui) { 
  /* we have a special variable, this._leftHandleOldLeft, to keep the
     previous position of the handle. We do that to know in what direction
     is the handle being dragged
  */
  
  var currentX = this.leftHandle.position()["left"];
  var leftHandleX = Math.floor(this.leftHandle.position()["left"]);

  var container_offset = this.selector.offset().left + this.selector.width();
  
  if (Math.floor(ui.position.left) < leftHandleX + 7) {
    /* prevent the handle from moving past the left handle */
    ui.position.left = leftHandleX + 7;
  }

  this.zoneWidth = Math.floor(ui.position.left) - (leftHandleX + 7);    
  
  this.sliceZone.css("width", this.zoneWidth);
  //this.sliceZone.css("left", this.zoneLeft + "px");
  this._rightHandleOldLeft = Math.floor(this._rightHandleOldLeft);  
  this.broadcastChanges();
};

/** tell to the world that the coordinates of the slice have
    changed 
*/
IriSP.SliceWidget.prototype.broadcastChanges = function() {
  var leftPercent = (this.zoneLeft / this.selector.width()) * 100;
  var zonePercent = (this.zoneWidth / this.selector.width()) * 100;

  this._Popcorn.trigger("IriSP.SliceWidget.zoneChange", [leftPercent, zonePercent]);  
};

IriSP.SliceWidget.prototype.show = function() {
  this.selector.show();
};

IriSP.SliceWidget.prototype.hide = function() {
  this.selector.hide();
};IriSP.SliderWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
};

IriSP.SliderWidget.prototype = new IriSP.Widget();

IriSP.SliderWidget.prototype.draw = function() {
  var self = this;

  this.selector.append(Mustache.to_html(IriSP.sliderWidget_template, {}));
  this.selector.addClass("Ldt-SliderMinimized");

  this.sliderBackground = this.selector.find(".Ldt-sliderBackground");
  this.sliderForeground = this.selector.find(".Ldt-sliderForeground");
  this.positionMarker = this.selector.find(".Ldt-sliderPositionMarker");


  // a special variable to stop methods from tinkering
  // with the positionMarker when the user is dragging it
  this.draggingOngoing = false;

  // another special variable used by the timeout handler to
  // open or close the slider.
  this.sliderMaximized = false;
  this.timeOutId = null;

  
  this.positionMarker.draggable({axis: "x",
  start: IriSP.wrap(this, this.positionMarkerDraggingStartedHandler),
  stop: IriSP.wrap(this, this.positionMarkerDraggedHandler),
  containment: "parent"
  });
  this.positionMarker.css("position", "absolute");
  
  this.sliderBackground.click(function(event) { self.backgroundClickHandler.call(self, event); });
  this.sliderForeground.click(function(event) { self.foregroundClickHandler.call(self, event); });

  this.selector.hover(IriSP.wrap(this, this.mouseOverHandler), IriSP.wrap(this, this.mouseOutHandler));

  // update the positions
  this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.sliderUpdater));

  // special messages :
  this._Popcorn.listen("IriSP.PlayerWidget.MouseOver", IriSP.wrap(this, this.mouseOverHandler));
  this._Popcorn.listen("IriSP.PlayerWidget.MouseOut", IriSP.wrap(this, this.mouseOutHandler));
};

/* update the slider and the position marker as time passes */
IriSP.SliderWidget.prototype.sliderUpdater = function() {
  if(this.draggingOngoing || this._disableUpdate)
    return;
  
  var time = this._Popcorn.currentTime();

  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var percents = time / duration;
  
  /* we do these complicated calculations to center exactly
     the position Marker */

  var divWidth = this.selector.width();
  var pixels = Math.floor(this.selector.width() * percents);
  var positionMarker_width = this.positionMarker.width();
  var correction = (positionMarker_width / 2);

  /* check that we don't leave the left side */
  var newPos = pixels - correction;
  if (newPos <= 0)
    newPos = 0;
  
  /* check that we don't leave the right side */
  var rightEdgePos = pixels + 1 * correction;

  if (rightEdgePos >= divWidth)
    newPos = divWidth - 1 * correction - 1;
  
  this.sliderForeground.css("width", pixels + "px");
  this.positionMarker.css("left", newPos + "px");

};

IriSP.SliderWidget.prototype.backgroundClickHandler = function(event) {
  /* this piece of code is a little bit convoluted - here's how it works :
     we want to handle clicks on the progress bar and convert those to seeks in the media.
     However, jquery only gives us a global position, and we want a number of pixels relative
     to our container div, so we get the parent position, and compute an offset to this position,
     and finally compute the progress ratio in the media.
     Finally we multiply this ratio with the duration to get the correct time
  */

  var parentOffset = this.sliderBackground.parent().offset();
  var width = this.sliderBackground.width();
  var relX = event.pageX - parentOffset.left;

  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var newTime = ((relX / width) * duration).toFixed(2);

  this._Popcorn.currentTime(newTime);
};

/* same function as the previous one, except that it handles clicks
   on the foreground element */
IriSP.SliderWidget.prototype.foregroundClickHandler = function(event) {
  var parentOffset = this.sliderForeground.parent().offset();
  var width = this.sliderBackground.width();
  var relX = event.pageX - parentOffset.left;

  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var newTime = ((relX / width) * duration).toFixed(2);

  this._Popcorn.currentTime(newTime);
};

/* handles mouse over the slider */
IriSP.SliderWidget.prototype.mouseOverHandler = function(event) {
  
  if (this.timeOutId !== null) {
    window.clearTimeout(this.timeOutId);
  }
 
  this.sliderMaximized = true;

  this.sliderBackground.animate({"height": "9px"}, 100);
  this.sliderForeground.animate({"height": "9px"}, 100);
  this.positionMarker.animate({"height": "9px", "width": "9px"}, 100);
  //this.positionMarker.css("margin-top", "-4px");
  
//  this.selector.removeClass("Ldt-SliderMinimized");
//  this.selector.addClass("Ldt-SliderMaximized");
};

/* handles when the mouse leaves the slider */
IriSP.SliderWidget.prototype.mouseOutHandler = function(event) {

  this.timeOutId = window.setTimeout(IriSP.wrap(this, this.minimizeOnTimeout),
                                     IriSP.widgetsDefaults.SliderWidget.minimize_period);
};

IriSP.SliderWidget.prototype.minimizeOnTimeout = function(event) {
  this.sliderBackground.animate({"height": "5px"}, 100);
  this.sliderForeground.animate({"height": "5px"}, 100);
  this.positionMarker.animate({"height": "5px", "width": "5px"}, 100);
  this.positionMarker.css("margin-top", "0px");
  this.sliderMinimized = true;
  
//  this.selector.removeClass("Ldt-SliderMaximized");
//  this.selector.addClass("Ldt-SliderMinimized");

};

// called when the user starts dragging the position indicator
IriSP.SliderWidget.prototype.positionMarkerDraggingStartedHandler = function(event, ui) {  
  this.draggingOngoing = true;
};

IriSP.SliderWidget.prototype.positionMarkerDraggedHandler = function(event, ui) {   
  this._disableUpdate = true; // disable slider position updates while dragging is ongoing.
  window.setTimeout(IriSP.wrap(this, function() { this._disableUpdate = false; }), 500);

  var parentOffset = this.sliderForeground.parent().offset();
  var width = this.sliderBackground.width();
  var relX = event.pageX - parentOffset.left;

  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var newTime = ((relX / width) * duration).toFixed(2);

  this._Popcorn.currentTime(newTime);
  
  this.draggingOngoing = false;
};

/** @class The constructor for the sparkline widget */
IriSP.SparklineWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);

  this._oldAnnotation = null;
  this._results = [];
};


IriSP.SparklineWidget.prototype = new IriSP.Widget();

IriSP.SparklineWidget.prototype.clear = function() {

};

/** draw the sparkline using jquery sparkline */
IriSP.SparklineWidget.prototype.draw = function() {
  var templ = Mustache.to_html(IriSP.SparklineWidget_template, {width: this.width, height: this.height});
  /** this widget uses three divs -
    the first is the sparkline, which is generated by jquery sparkline,
    the second is an overlay div to display the progression in the video,
    and the third is a div to react to clicks
  */
  
  var views = this._serializer._data.views;
  var stat_view;
  if (!IriSP.null_or_undefined(views)) {
    
    var i;
    for (i = 0; i < views.length; i++) {
      var view = views[i];
      if (view.id === "stat") {
          stat_view = view;
          break;
      }
    }
  }
  
  // If we've found the correct view, feed the directly the data from the view
  // to jquery sparkline. Otherwise, compute it ourselves.
  if (!IriSP.null_or_undefined(stat_view)) {
    console.log("sparklinewidget : using stats embedded in the json");
    var results = stat_view.meta.stat.split(",");      
  } else {
    console.log("sparklinewidget : computing stats ourselves");
    var num_columns = (this.selector.width()) / IriSP.widgetsDefaults["SparklineWidget"].column_width;
    var duration = +this._serializer.currentMedia().meta["dc:duration"];
    var time_step = duration / num_columns; /* the time interval between two columns */
    var results = [];
    var i = 0; /* the index in the loop */  

    /* this algorithm makes one assumption : that the array is sorted 
       (it's done for us by the JSONSerializer). We go through the array 
       and count how many comments fall within a peculiar time piece.
       As i is preserved between each iteration, it's O(n).
    */
    
    for(var j = 0; j < num_columns && i < this._serializer._data.annotations.length; j++) {    
      var count = 0;
      var annotation_begin = +(this._serializer._data.annotations[i].begin);
      
      while(annotation_begin >= j * time_step && annotation_begin <= (j + 1) * time_step ) {
        count++;
        i++;
        if (i >= this._serializer._data.annotations.length)
          break;
          
        annotation_begin = +(this._serializer._data.annotations[i].begin);
        
      }
      
      results.push(count);
    }
  }
  
  // save the results in an array so that we can re-use them when a new annotation
  // is added.
  this._results = results;
  
  this.selector.append(templ);
  this.selector.find(".Ldt-sparkLine").css("background", "#c7c8cc");
  this.selector.find(".Ldt-sparkLine").sparkline(results, {lineColor: "#7492b4", fillColor: "#aeaeb8",
                                                           spotColor: "#b70056",
                                                           width: this.width, height: this.height});
  this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.timeUpdateHandler));
  this._Popcorn.listen("IriSP.createAnnotationWidget.addedAnnotation", IriSP.wrap(this, this.handleNewAnnotation));
  
  IriSP.jQuery(".Ldt-sparkLineClickOverlay").click(IriSP.wrap(this, this.clickHandler));  
};

/** react to a timeupdate event */
IriSP.SparklineWidget.prototype.timeUpdateHandler = function() {
  var currentTime = this._Popcorn.currentTime();  
  var duration = +this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var proportion = ((currentTime / duration) * 100).toFixed(4);
  
  IriSP.jQuery(".Ldt-sparkLinePositionMarker").css("width", proportion + "%");                                    
}

/** handle clicks on the widget */
IriSP.SparklineWidget.prototype.clickHandler = function(event) {
  /* this piece of code is a little bit convoluted - here's how it works :
     we want to handle clicks on the progress bar and convert those to seeks in the media.
     However, jquery only gives us a global position, and we want a number of pixels relative
     to our container div, so we get the parent position, and compute an offset to this position,
     and finally compute the progress ratio in the media.
     Finally we multiply this ratio with the duration to get the correct time
  */

  var parentOffset = this.selector.offset();
  var width = this.selector.width();
  var relX = event.pageX - parentOffset.left;

  var duration = this._serializer.currentMedia().meta["dc:duration"] / 1000;
  var newTime = ((relX / width) * duration).toFixed(2);
    
  this._Popcorn.trigger("IriSP.SparklineWidget.clicked", newTime);
  this._Popcorn.currentTime(newTime);                                 
};

/** react when a new annotation is added */
IriSP.SparklineWidget.prototype.handleNewAnnotation = function(annotation) {
  var num_columns = this._results.length;
  var duration = +this._serializer.currentMedia().meta["dc:duration"];
  var time_step = Math.round(duration / num_columns); /* the time interval between two columns */
  var begin = +annotation.begin;
  var end = +annotation.end;
  
  /* increment all the values between the beginning and the end of the annotation */
  var index_begin = Math.floor(begin / time_step);
  var index_end = Math.floor(end / time_step);
  
  for (var i = index_begin; i < Math.min(index_end, this._results.length); i++) {
    this._results[i]++;
  }
  
  this.selector.find(".Ldt-sparkLine").sparkline(this._results, {lineColor: "#7492b4", fillColor: "#aeaeb8",
                                                           spotColor: "#b70056",
                                                           width: this.width, height: this.height});
};IriSP.StackGraphWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
}

IriSP.StackGraphWidget.prototype = new IriSP.Widget();

IriSP.StackGraphWidget.prototype.draw = function() {
    var _defaultTags = [
            {
                "keywords" : [ "++" ],
                "description" : "positif",
                "color" : "#1D973D"
            },
            {
                "keywords" : [ "--" ],
                "description" : "negatif",
                "color" : "#CE0A15"
            },
            {
                "keywords" : [ "==" ],
                "description" : "reference",
                "color" : "#C5A62D"  
            },
            {
                "keywords" : [ "??" ],
                "description" : "question",
                "color" : "#036AAE"
            }
        ],
        _defaultDefColor = "#585858";
    this.height =  this._config.height || 50;
    this.width = this.selector.width();
    this.isStreamGraph = this._config.streamgraph || false;
    this.sliceCount = this._config.slices || ~~(this.width/(this.isStreamGraph ? 20 : 5));
    this.tagconf = (this._config.tags
        ? this._config.tags
        : _defaultTags);
    IriSP._(this.tagconf).each(function(_a) {
        _a.regexp = new RegExp(_a.keywords.map(function(_k) {
            return _k.replace(/([\W])/gm,'\\$1');
        }).join("|"),"im")
    });
    this.defaultcolorconf = (this._config.defaultcolor
        ? this._config.defaultcolor
        : _defaultDefColor);
    this.paper = new Raphael(this.selector[0], this.width, this.height);
    this.groups = [];
    this.duration = this._serializer.currentMedia().meta["dc:duration"];
    
    var _annotationType = this._serializer.getTweets(),
        _sliceDuration = ~~ ( this.duration / this.sliceCount),
        _annotations = this._serializer._data.annotations,
        _groupedAnnotations = IriSP._.range(this.sliceCount).map(function(_i) {
            return _annotations.filter(function(_a){
                return (_a.begin <= (1 + _i) * _sliceDuration) && (_a.end >= _i * _sliceDuration)
            });
        }),
        _max = IriSP._(_groupedAnnotations).max(function(_g) {
            return _g.length
        }).length,
        _scale = this.height / _max,
        _width = this.width / this.sliceCount
        _showTitle = !this._config.excludeTitle,
        _showDescription = !this._config.excludeDescription;
    
    
    var _paths = this.tagconf.map(function() {
        return [];
    });
    _paths.push([]);
    
    for (var i = 0; i < this.sliceCount; i++) {
        var _group = _groupedAnnotations[i];
        if (_group) {
            var _vol = this.tagconf.map(function() {
                return 0;
            });
            for (var j = 0; j < _group.length; j++){
           var _txt = (_showTitle ? _group[j].content.title : '') + ' ' + (_showDescription ? _group[j].content.description : '')
                var _tags = this.tagconf.map(function(_tag) {
                        return (_txt.search(_tag.regexp) == -1 ? 0 : 1)
                    }),
                    _nbtags = _tags.reduce(function(_a,_b) {
                        return _a + _b;
                    }, 0);
                if (_nbtags) {
                    IriSP._(_tags).each(function(_v, _k) {
                        _vol[_k] += (_v / _nbtags);
                    });
                }
            }
            var _nbtags = _vol.reduce(function(_a,_b) {
                    return _a + _b;
                }, 0),
                _nbneutre = _group.length - _nbtags,
                _h = _nbneutre * _scale,
                _base = this.height - _h;
            if (!this.isStreamGraph) {
                this.paper.rect(i * _width, _base, _width - 1, _h ).attr({
                    "stroke" : "none",
                    "fill" : this.defaultcolorconf
                });
            }
           _paths[0].push(_base);
            for (var j = 0; j < this.tagconf.length; j++) {
                _h = _vol[j] * _scale;
                _base = _base - _h;
                if (!this.isStreamGraph) {
                    this.paper.rect(i * _width, _base, _width - 1, _h ).attr({
                        "stroke" : "none",
                        "fill" : this.tagconf[j].color
                    });
                }
                _paths[j+1].push(_base);
            }
            this.groups.push(_vol.map(function(_v) {
                return _v / _group.length;
            }))
        } else {
            for (var j = 0; j < _paths.length; j++) {
                _paths[j].push(this.height);
            }
            this.groups.push(this.tagconf.map(function() {
                return 0;
            }));
        }
    }
    
    if (this.isStreamGraph) {
        for (var j = _paths.length - 1; j >= 0; j--) {
            var _d = _paths[j].reduce(function(_memo, _v, _k) {
               return _memo + ( _k
                   ? 'C' + (_k * _width) + ' ' + _paths[j][_k - 1] + ' ' + (_k * _width) + ' ' + _v + ' ' + ((_k + .5) * _width) + ' ' + _v
                   : 'M0 ' + _v + 'L' + (.5*_width) + ' ' + _v )
            },'') + 'L' + this.width + ' ' + _paths[j][_paths[j].length - 1] + 'L' + this.width + ' ' + this.height + 'L0 ' + this.height;
            this.paper.path(_d).attr({
                "stroke" : "none",
                "fill" : (j ? this.tagconf[j-1].color : this.defaultcolorconf)
            });
        }
    }
    this.rectangleFocus = this.paper.rect(0,0,_width,this.height)
        .attr({
            "stroke" : "none",
            "fill" : "#ff00ff",
            "opacity" : 0
        })
    this.rectangleProgress = this.paper.rect(0,0,0,this.height)
        .attr({
            "stroke" : "none",
            "fill" : "#808080",
            "opacity" : .3
        });
    this.ligneProgress = this.paper.path("M0 0L0 "+this.height).attr({"stroke":"#ff00ff", "line-width" : 2})
    
    this._Popcorn.listen("timeupdate", IriSP.wrap(this, this.timeUpdateHandler));
    var _this = this;
    this.selector
        .click(IriSP.wrap(this, this.clickHandler))
        .mousemove(function(event) {
            _this.updateTooltip(event);
            
            // Also tell the world where the mouse is hovering.
            var relX = event.pageX - _this.selector.offset().left;
            var duration = _this._serializer.currentMedia().meta["dc:duration"];
            var Time = ((relX / _this.width) * duration).toFixed(2);
            _this._Popcorn.trigger("IriSP.StackGraphWidget.mouseOver", Time);

        })
        .mouseout(function() {
            _this.TooltipWidget.hide();
            _this.rectangleFocus.attr({
                "opacity" : 0
            })
        })
}

IriSP.StackGraphWidget.prototype.timeUpdateHandler = function() {
    var _currentTime = this._Popcorn.currentTime(),
        _x = (1000 * _currentTime / this.duration) * this.width;
    this.rectangleProgress.attr({
        "width" : _x
    });
    this.ligneProgress.attr({
        "path" : "M" + _x + " 0L" + _x + " " + this.height
    })
}

IriSP.StackGraphWidget.prototype.clickHandler = function(event) {
  /* Ctrl-C Ctrl-V'ed from another widget
  */

  var relX = event.pageX - this.selector.offset().left;
  var newTime = ((relX / this.width) * this.duration/1000).toFixed(2);
  this._Popcorn.trigger("IriSP.StackGraphWidget.clicked", newTime);
  this._Popcorn.currentTime(newTime);                                 
};

IriSP.StackGraphWidget.prototype.updateTooltip = function(event) {
    var _segment = ~~(this.sliceCount * (event.pageX - this.selector.offset().left)/this.width),
        _valeurs = this.groups[_segment],
        _width = this.width / this.sliceCount,
        _html = '<ul style="list-style: none; margin: 0; padding: 0;">' + this.tagconf.map(function(_tag, _i) {
            return '<li style="clear: both;"><span style="float: left; width: 10px; height: 10px; margin: 2px; background: '
                + _tag.color
                + ';"></span>'
                + ~~(100 * _valeurs[_i])
                + '% de '
                + _tag.description
                + '</li>';
        }).join('') + '</ul>';
    this.TooltipWidget._shown = false; // Vraiment, on ne peut pas ouvrir le widget s'il n'est pas encore ouvert ?
    this.TooltipWidget.show('','',event.pageX - 105, event.pageY - 160);
    this.TooltipWidget.selector.find(".tip").html(_html);
    this.rectangleFocus.attr({
        "x" : _segment * _width,
        "opacity" : .4
    })
}

IriSP.TagCloudWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
}

IriSP.TagCloudWidget.prototype = new IriSP.Widget();

IriSP.TagCloudWidget.prototype.draw = function() {
    
    var _stopwords = [
            'aussi', 'and', 'avec', 'aux', 'car', 'cette', 'comme', 'dans', 'donc', 'des', 'elle', 'est',
            'être', 'eux', 'fait', 'ici', 'ils', 'les', 'leur', 'leurs', 'mais', 'mes', 'même', 'mon', 'notre',
            'non', 'nos', 'nous', 'ont', 'par', 'pas', 'peu', 'pour', 'que', 'qui', 'ses' ,'son', 'sont', 'sur',
            'tes', 'très', 'the', 'ton', 'tous', 'tout', 'une', 'votre', 'vos', 'vous'
        ],
        _regexpword = /[^\s\.&;,'"!\?\d\(\)\+\[\]\\\…\-«»:\/]{3,}/g,
        _words = {},
        _showTitle = !this._config.excludeTitle,
        _showDescription = !this._config.excludeDescription,
        _tagCount = this._config.tagCount || 30;
    
    IriSP._(this._serializer._data.annotations).each(function(_annotation) {
       if (_annotation.content && _annotation.content.description) {
           var _txt = (_showTitle ? _annotation.content.title : '') + ' ' + (_showDescription ? _annotation.content.description : '')
           IriSP._(_txt.toLowerCase().match(_regexpword)).each(function(_mot) {
               if (_stopwords.indexOf(_mot) == -1) {
                   _words[_mot] = 1 + (_words[_mot] || 0);
               }
           })
       } 
    });
    
    _words = IriSP._(_words)
        .chain()
        .map(function(_v, _k) {
            return {
                "word" : _k,
                "count" : _v
            }
        })
        .filter(function(_v) {
            return _v.count > 2;
        })
        .sortBy(function(_v) {
            return - _v.count;
        })
        .first(_tagCount)
        .value();
    var _max = _words[0].count,
        _min = Math.min(_words[_words.length - 1].count, _max - 1),
        _scale = 16 / Math.sqrt(_max - _min),
        _this = this,
        _html = '<ul>'
            + IriSP._(_words)
                .chain()
                .shuffle()
                .map(function(_word) {
                    var _size = 10 + _scale * Math.sqrt(_word.count - _min);
                    return '<li style="font-size:'
                        + _size
                        + 'px;">'
                        + _word.word
                        + '</li>'
                })
                .value()
                .join("")
            + '</ul>';
    this.selector
        .addClass("Ldt-TagCloud")
        .html(_html);
    this.selector.find("li").click(function() {
        var _txt = this.textContent.replace(/(^[\s]+|[\s]+$)/g,'');
        _this._Popcorn.trigger("IriSP.search.triggeredSearch", _txt);
    });
    this._Popcorn.listen("IriSP.search", IriSP.wrap(this, function(searchString) {
        var _rgxp = new RegExp("(" + searchString.replace(/(\W)/g,'\\$1') + ")","gi");
        this.selector.find("li").each(function(_i, _e) {
            _e.innerHTML = searchString.length ?
                _e.textContent.replace(_rgxp,'<span class="Ldt-TagCloud-actif">$1</span>')
                : _e.textContent;
        });
    }));
    this._Popcorn.listen("IriSP.search.closed", IriSP.wrap(this, this.endsearch));
    this._Popcorn.listen("IriSP.search.cleared", IriSP.wrap(this, this.endsearch));
}

IriSP.TagCloudWidget.prototype.endsearch = function() {
    this.selector.find("li").each(function(_i, _e) {
        _e.innerHTML = _e.textContent;
    });
}
/* this widget displays a small tooltip */
IriSP.TooltipWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);
  this._shown = false;
  this._displayedText = "";
  this._hideTimeout = -1;
};


IriSP.TooltipWidget.prototype = new IriSP.Widget();

IriSP.TooltipWidget.prototype.draw = function() {
  var templ = Mustache.to_html(IriSP.tooltipWidget_template);
  // position the widget absolutely relative to document.
  this.selector.css("position", "static");
  this.selector.append(templ);
  this.hide();

};

IriSP.TooltipWidget.prototype.clear = function() {
	this.selector.find(".tiptext").html("");
};

IriSP.TooltipWidget.prototype.show = function(text, color, x, y) {

  if (this._displayedText == text && this._shown)
    return;

  this.selector.find(".tipcolor").css("background-color", color);
  this._displayedText = text;
	this.selector.find(".tiptext").html(text);
  
  if (x < 0)
    x = 0;
  if (y < 0)
    y = 0;
  
  this.selector.find(".tip").css("left", x).css("top", y);
  this.selector.find(".tip").show();
  this._shown = true;
};

IriSP.TooltipWidget.prototype.hide = function() {                                                   
  this.selector.find(".tip").hide();
  this._shown = false;  
};/* a widget that displays tweet - used in conjunction with the polemicWidget */

IriSP.TweetsWidget = function(Popcorn, config, Serializer) {
  IriSP.Widget.call(this, Popcorn, config, Serializer);

  this._displayingTweet = false;
  this._timeoutId = undefined; 
  this._hidden = false; /* hidden means that the createAnnotationWidget is shown */
};


IriSP.TweetsWidget.prototype = new IriSP.Widget();


IriSP.TweetsWidget.prototype.drawTweet = function(annotation) {
    if (this._hidden)
      return;
    
    var title = IriSP.formatTweet(annotation.content.title);
    var img = annotation.content.img.src;
    if (typeof(img) === "undefined" || img === "" || img === "None") {
      img = IriSP.widgetsDefaults.TweetsWidget.default_profile_picture;
    }

    var imageMarkup = IriSP.templToHTML("<img src='{{src}}' alt='user image'></img>", 
                                       {src : img});
    
    if (typeof(annotation.meta["dc:source"].content) !== "undefined") {
      var tweetContents = JSON.parse(annotation.meta["dc:source"].content);
      var creator = tweetContents.user.screen_name;
      var real_name = tweetContents.user.name;

      imageMarkup = IriSP.templToHTML("<a href='http://twitter.com/{{creator}}'><img src='{{src}}' alt='user image'></img></a>", 
                                       {src : img, creator: creator});
            
      var formatted_date = new Date(tweetContents.created_at).toLocaleDateString();
      title = IriSP.templToHTML("<a class='Ldt-tweet_userHandle' href='http://twitter.com/{{creator}}'>@{{creator}}</a> - " + 
                                "<div class='Ldt-tweet_realName'>{{real_name}}</div>" +
                                "<div class='Ldt-tweet_tweetContents'>{{{ contents }}}</div>" +
                                "<div class='Ldt-tweet_date'>{{ date }}</div>", 
                                {creator: creator, real_name: real_name, contents : title, date : formatted_date});

      this.selector.find(".Ldt-TweetReply").attr("href", "http://twitter.com/home?status=@" + creator + ":%20");


      var rtText = Mustache.to_html("http://twitter.com/home?status=RT @{{creator}}: {{text}}",
                                    {creator: creator, text: IriSP.encodeURI(annotation.content.title)});
      this.selector.find(".Ldt-Retweet").attr("href", rtText);
    }

    this.selector.find(".Ldt-tweetContents").html(title);
    this.selector.find(".Ldt-tweetAvatar").html(imageMarkup);
    this.selector.show("blind", 250); 
};

IriSP.TweetsWidget.prototype.displayTweet = function(annotation) {
  if (this._displayingTweet === false) {
    this._displayingTweet = true;
  } else {
    window.clearTimeout(this._timeoutId);
  }

  this.drawTweet(annotation);

  var time = this._Popcorn.currentTime();  
  this._timeoutId = window.setTimeout(IriSP.wrap(this, this.clearPanel), IriSP.widgetsDefaults.TweetsWidget.tweet_display_period);
};


IriSP.TweetsWidget.prototype.clearPanel = function() {  
    this._displayingTweet = false;
    this._timeoutId = undefined;
    this.closePanel();
    
};

IriSP.TweetsWidget.prototype.closePanel = function() {
    if (this._timeoutId != undefined) {
      /* we're called from the "close window" link */
      /* cancel the timeout */
      window.clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    
    this.selector.hide("blind", 400);
    
};

/* cancel the timeout if the user clicks on the keep panel open button */
IriSP.TweetsWidget.prototype.keepPanel = function() {
    if (this._timeoutId != undefined) {
      /* we're called from the "close window" link */
      /* cancel the timeout */
      window.clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
};

IriSP.TweetsWidget.prototype.draw = function() {
  var _this = this;
  
  var tweetMarkup = IriSP.templToHTML(IriSP.tweetWidget_template, {"share_template" : IriSP.share_template});
  this.selector.append(tweetMarkup);
  this.selector.hide();
  this.selector.find(".Ldt-tweetWidgetMinimize").click(IriSP.wrap(this, this.closePanel));
  this.selector.find(".Ldt-tweetWidgetKeepOpen").click(IriSP.wrap(this, this.keepPanel));
  
  this._Popcorn.listen("IriSP.PolemicTweet.click", IriSP.wrap(this, this.PolemicTweetClickHandler));
  this._Popcorn.listen("IriSP.PlayerWidget.AnnotateButton.clicked", 
                        IriSP.wrap(this, this.handleAnnotateSignal));  
};

IriSP.TweetsWidget.prototype.PolemicTweetClickHandler = function(tweet_id) {  
  var index, annotation;
  for (index in this._serializer._data.annotations) {
    annotation = this._serializer._data.annotations[index];
    
    if (annotation.id === tweet_id)
      break;
  }
    
  if (annotation.id !== tweet_id)
      /* we haven't found it */
      return;
  
  this.displayTweet(annotation);
  return;
};

/** handle clicks on the annotate button by hiding/showing itself */
IriSP.TweetsWidget.prototype.handleAnnotateSignal = function() {
  if (this._hidden == false) {
    this.selector.hide();
    this._hidden = true;
  } else {
    if (this._displayingTweet !== false)
      this.selector.show();
      
    
    this._hidden = false;
  }
};/** @class This class implement a serializer for the JSON-Cinelab format
    @params DataLoader a dataloader reference
    @url the url from which to get our cinelab
 */
IriSP.JSONSerializer = function(DataLoader, url) {
  IriSP.Serializer.call(this, DataLoader, url);
};

IriSP.JSONSerializer.prototype = new IriSP.Serializer();

/** serialize data */
IriSP.JSONSerializer.prototype.serialize = function(data) {
  return JSON.stringify(data);
};

/** deserialize data */
IriSP.JSONSerializer.prototype.deserialize = function(data) {
  return JSON.parse(data);
};

/** load JSON-cinelab data and also sort the annotations by start time
    @param callback function to call when the data is ready.
 */
IriSP.JSONSerializer.prototype.sync = function(callback) {
  /* we don't have to do much because jQuery handles json for us */

  var self = this;

  var fn = function(data) {      
      self._data = data;  
      if (typeof(self._data["annotations"]) === "undefined" ||
          self._data["annotations"] === null)
          self._data["annotations"] = [];
      
      // sort the data too       
      self._data["annotations"].sort(function(a, b) 
          { var a_begin = +a.begin;
            var b_begin = +b.begin;
            return a_begin - b_begin;
          });
     
      callback(data);      
  };
  
  this._DataLoader.get(this._url, fn);
};

/** @return the metadata about the media being read FIXME: always return the first media. */
IriSP.JSONSerializer.prototype.currentMedia = function() {  
  return this._data.medias[0]; /* FIXME: don't hardcode it */
};

/** searches for an annotation which matches title, description and keyword 
   "" matches any field. 
   Note: it ignores tweets.
   @return a list of matching ids.
*/    
IriSP.JSONSerializer.prototype.searchAnnotations = function(title, description, keyword) {
    /* we can have many types of annotations. We want search to only look for regular segments */
    /* the next two lines are a bit verbose because for some test data, _serializer.data.view is either
       null or undefined.
    */
    var view;

    if (typeof(this._data.views) !== "undefined" && this._data.views !== null)
       view = this._data.views[0];

    var searchViewType = "";

    if(typeof(view) !== "undefined" && typeof(view.annotation_types) !== "undefined" && view.annotation_types.length > 1) {
            searchViewType = view.annotation_types[0];
    }

    var filterfn = function(annotation) {
      if( searchViewType  != "" && 
          typeof(annotation.meta) !== "undefined" && 
          typeof(annotation.meta["id-ref"]) !== "undefined" &&
          annotation.meta["id-ref"] !== searchViewType) {
        return true; // don't pass
      } else {
          return false;
      }
    };

    return this.searchAnnotationsFilter(title, description, keyword, filterfn);

};

/* only look for tweets */
IriSP.JSONSerializer.prototype.searchTweets = function(title, description, keyword) {
    /* we can have many types of annotations. We want search to only look for regular segments */
    /* the next two lines are a bit verbose because for some test data, _serializer.data.view is either
       null or undefined.
    */
    
    var searchViewType = this.getTweets();
    if (typeof(searchViewType) === "undefined") {
      var view;
      
      if (typeof(this._data.views) !== "undefined" && this._data.views !== null)
         view = this._data.views[0];    

      if(typeof(view) !== "undefined" && typeof(view.annotation_types) !== "undefined" && view.annotation_types.length > 1) {
              searchViewType = view.annotation_types[0];
      }
    }
    var filterfn = function(annotation) {
      if( searchViewType  != "" && 
          typeof(annotation.meta) !== "undefined" && 
          typeof(annotation.meta["id-ref"]) !== "undefined" &&
          annotation.meta["id-ref"] === searchViewType) {
        return false; // pass
      } else {
          return true;
      }
    };

    return this.searchAnnotationsFilter(title, description, keyword, filterfn);

};

/**
  search an annotation according to its title, description and keyword
  @param filter a function to filter the results with. Used to select between annotation types.
 */    
IriSP.JSONSerializer.prototype.searchAnnotationsFilter = function(title, description, keyword, filter) {

    var rTitle;
    var rDescription;
    var rKeyword;
    /* match anything if given the empty string */
    if (title == "")
      title = ".*";
    if (description == "")
      description = ".*";
    if (keyword == "")
      keyword = ".*";
    
    rTitle = new RegExp(title, "i");  
    rDescription = new RegExp(description, "i");  
    rKeyword = new RegExp(keyword, "i");  
    
    var ret_array = [];
    
    var i;
    for (i in this._data.annotations) {
      var annotation = this._data.annotations[i];
      
      /* filter the annotations whose type is not the one we want */
      if (filter(annotation)) {
          continue;
      }
      
      if (rTitle.test(annotation.content.title) && 
          rDescription.test(annotation.content.description)) {
          /* FIXME : implement keyword support */
          ret_array.push(annotation);
      }
    }
    
    return ret_array;
};

/** breaks a string in words and searches each of these words. Returns an array
   of objects with the id of the annotation and its number of occurences.
   
   @param searchString a string of words.
   FIXME: optimize ? seems to be n^2 in the worst case.
*/
IriSP.JSONSerializer.prototype.searchOccurences = function(searchString) {
  var ret = { };
  var keywords = searchString.split(/\s+/);
  
  for (var i in keywords) {
    var keyword = keywords[i];
    
    // search this keyword in descriptions and title
    var found_annotations = []
    found_annotations = found_annotations.concat(this.searchAnnotations(keyword, "", ""));
    found_annotations = found_annotations.concat(this.searchAnnotations("", keyword, ""));
    
    for (var j in found_annotations) {
      var current_annotation = found_annotations[j];
      
      if (!ret.hasOwnProperty(current_annotation.id)) {
        ret[current_annotation.id] = 1;
      } else {
        ret[current_annotation.id] += 1;
      }
      
    }

  };
  
  return ret;
};

/** breaks a string in words and searches each of these words. Returns an array
   of objects with the id of the annotation and its number of occurences.
   
   FIXME: optimize ? seems to be n^2 in the worst case.
*/
IriSP.JSONSerializer.prototype.searchTweetsOccurences = function(searchString) {
  var ret = { };
  var keywords = searchString.split(/\s+/);
  
  for (var i in keywords) {
    var keyword = keywords[i];
    
    // search this keyword in descriptions and title
    var found_annotations = []
    found_annotations = found_annotations.concat(this.searchTweets(keyword, "", ""));
    found_annotations = found_annotations.concat(this.searchTweets("", keyword, ""));
    
    for (var j in found_annotations) {
      var current_annotation = found_annotations[j];
      
      if (!ret.hasOwnProperty(current_annotation.id)) {
        ret[current_annotation.id] = 1;
      } else {
        ret[current_annotation.id] += 1;
      }
      
    }

  };
  
  return ret;
};

/** returns all the annotations that are displayable at the moment 
   NB: only takes account the first type of annotations - ignores tweets 
   currentTime is in seconds.
   
   @param currentTime the time at which we search.
   @param (optional) the if of the type of the annotations we want to get.
 */

IriSP.JSONSerializer.prototype.currentAnnotations = function(currentTime, id) {
  var view;
  var currentTimeMs = 1000 * currentTime;

  if (typeof(id) === "undefined") {
      var legal_ids = this.getNonTweetIds();
  } else {
      legal_ids = [id];
  }
  
  var ret_array = [];
  
  var i;
  
  for (i in this._data.annotations) {
    var annotation = this._data.annotations[i];
    
    if (IriSP.underscore.include(legal_ids, annotation.meta["id-ref"]) && 
        annotation.begin <= currentTimeMs &&
        annotation.end >= currentTimeMs)
          ret_array.push(annotation);
  }
 
  if (ret_array == []) {
    console.log("ret_array empty, ", legal_ids);
  }
  
  return ret_array;
};

/** return the current chapitre
    @param currentTime the current time, in seconds.
*/
IriSP.JSONSerializer.prototype.currentChapitre = function(currentTime) {
  return this.currentAnnotations(currentTime, this.getChapitrage())[0];
};

/** returns a list of ids of tweet lines (aka: groups in cinelab) */
IriSP.JSONSerializer.prototype.getTweetIds = function() {
  if (IriSP.null_or_undefined(this._data.lists) || IriSP.null_or_undefined(this._data.lists) ||
      IriSP.null_or_undefined(this._data.views) || IriSP.null_or_undefined(this._data.views[0]))
    return [];

  
  /* Get the displayable types
     We've got to jump through a few hoops because the json sometimes defines
     fields with underscores and sometimes with dashes
  */
  var annotation_types = this._data.views[0]["annotation_types"];
  if (IriSP.null_or_undefined(annotation_types)) {
    annotation_types = this._data.views[0]["annotation-types"];
    if (IriSP.null_or_undefined(annotation_types)) {
      console.log("neither view.annotation_types nor view.annotation-types are defined");      
      return;
    }
  }

  var available_types = this._data["annotation_types"];    
  if (IriSP.null_or_undefined(available_types)) {
    available_types = this._data["annotation-types"];
    if (IriSP.null_or_undefined(available_types)) {
      console.log("neither annotation_types nor annotation-types are defined");      
      return;
    }
  }
  
  var potential_types = [];
  
  // Get the list of types which contain "Tw" in their content
  for (var i = 0; i < available_types.length; i++) {
    if (/Tw/i.test(available_types[i]["dc:title"])) {
      potential_types.push(available_types[i].id);
    }
  }
  
  // Get the intersection of both.
  var tweetsId = IriSP.underscore.intersection(annotation_types, potential_types);
  
  return tweetsId;
};

/** this function returns a list of lines which are not tweet lines */
IriSP.JSONSerializer.prototype.getNonTweetIds = function() {
  if (IriSP.null_or_undefined(this._data.lists) || IriSP.null_or_undefined(this._data.lists) ||
      IriSP.null_or_undefined(this._data.views) || IriSP.null_or_undefined(this._data.views[0]))
    return [];

  /* Get the displayable types
     We've got to jump through a few hoops because the json sometimes defines
     fields with underscores and sometimes with dashes
  */
  var annotation_types = this._data.views[0]["annotation_types"];
  if (IriSP.null_or_undefined(annotation_types)) {
    annotation_types = this._data.views[0]["annotation-types"];
    if (IriSP.null_or_undefined(annotation_types)) {
      console.log("neither view.annotation_types nor view.annotation-types are defined");      
      return;
    }
  }

  var available_types = this._data["annotation_types"];    
  if (IriSP.null_or_undefined(available_types)) {
    available_types = this._data["annotation-types"];
    if (IriSP.null_or_undefined(available_types)) {
      console.log("neither annotation_types nor annotation-types are defined");      
      return;
    }
  }

  var potential_types = [];
  
  // Get the list of types which do not contain "Tw" in their content
  for (var i = 0; i < available_types.length; i++) {
    if (!(/Tw/i.test(available_types[i]["dc:title"]))) {
      potential_types.push(available_types[i].id);
    }
  }

  // Get the intersection of both.
  var nonTweetsId = IriSP.underscore.intersection(annotation_types, potential_types);
  
  return nonTweetsId;
  
};

/** return the id of the ligne de temps which contains name
    @param name of the ligne de temps
*/
IriSP.JSONSerializer.prototype.getId = function(name) {
  if (IriSP.null_or_undefined(this._data["annotation-types"]))
    return;

  name = name.toUpperCase();
  var e;  
  e = IriSP.underscore.find(this._data["annotation-types"], 
                                  function(entry) { 
                                    if (IriSP.null_or_undefined(entry["dc:title"]))
                                      return false;
                                    
                                    return (entry["dc:title"].toUpperCase().indexOf(name) !== -1) });
  
  if (typeof(e) === "undefined")
    return;
    
  var id = e.id;

  return id;
};

/** return the list of id's of the ligne de temps which contains name
    @param name of the ligne de temps
*/
IriSP.JSONSerializer.prototype.getIds = function(name) {
  if (IriSP.null_or_undefined(this._data["annotation-types"]))
    return;

  name = name.toUpperCase();
  var e = [];  
  e = IriSP.underscore.filter(this._data["annotation-types"], 
                                  function(entry) { return (entry["dc:title"].toUpperCase().indexOf(name) !== -1) });
  return IriSP.underscore.pluck(e, "id");  
};

/** return the id of the ligne de temps named "Chapitrage" */
IriSP.JSONSerializer.prototype.getChapitrage = function() {
  var val = this.getId("Chapitrage");
  if (typeof(val) === "undefined")
    val = this.getId("Chapter");   
  if (typeof(val) === "undefined")
    val = this.getId("Chapit");
  if (typeof(val) === "undefined")
    val = this.getId("Chap");
    
  return val;
};

/** return the id of the ligne de temps named "Tweets" */
IriSP.JSONSerializer.prototype.getTweets = function() {
  var val = this.getId("Tweets");
  if (typeof(val) === "undefined")
    val = this.getId("Tweet");
  if (typeof(val) === "undefined")
    val = this.getId("Twitter");
  if (typeof(val) === "undefined")
    val = this.getId("twit");
  if (typeof(val) === "undefined")
    val = this.getId("Polemic");
  
  return val;
};

/** return the id of the ligne de temps named "Contributions" */
IriSP.JSONSerializer.prototype.getContributions = function() {
  var val = this.getId("Contribution");
  if (typeof(val) === "undefined")
    val = this.getId("Particip");   
  if (typeof(val) === "undefined")
    val = this.getId("Contr");
  if (typeof(val) === "undefined")
    val = this.getId("Publ");
    
  return val;
};