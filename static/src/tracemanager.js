/*
 * Modelled Trace API
 */
(function($) {
     /*
      * FIXME: Write proper representation functions (str, json, ...)
      */

     var BufferedService_prototype = {
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
             // FIXME: should add a counter to avoid starving the sync
             // process in case of too many generated obsels.
             // FIXME: add mutex on this.buffer
             if (! this.isReady)
             {
                 if (window.console) window.console.log("Sync service not ready");
             } else if (this.buffer.length) {
                 var temp = this.buffer;
                 this.buffer = [];

                 if (this.mode == 'GET')
                 {
                     // GET mode: do some data mangline. We mark the
                     // "compressed" nature of the generated JSON by
                     // prefixing it with c
                     var data = 'c' + JSON.stringify(temp.map(function (o) { return o.toCompactJSON(); }));
                     // Swap " (very frequent, which will be
                     // serialized into %22) and / (rather rare), this
                     // saves some bytes
                     data = data.replace(/[\/"]/g, function(s){ return s == '/' ? '"' : '/'; });
                     // FIXME: check data length (< 2K is safe)
                     var request=$('<img />').error( function() { this.failureCount += 1; })
                         .load( function() { this.failureCount = 0; })
                         .attr('src', this.url + 'trace/?data=' + data);
                 }
                 else
                 {
                     $.ajax({ url: this.url + 'trace/',
                              type: 'POST',
                              contentType: 'application/json',
                              data: JSON.stringify(temp.map(function (o) { return o.toJSON(); })),
                              processData: false,
                              // Type of the returned data.
                              dataType: "html",
                              error: function(jqXHR, textStatus, errorThrown) {
                                  // FIXME: not called for JSONP/crossdomain
                                  if (window.console) window.console.log("Error when sending buffer:", textStatus);
                                  this.failureCount += 1;
                              },
                              success: function(data, textStatus, jqXHR) {
                                  // FIXME: parse the returned JSON, and get
                                  // the updated properties (id, uri...) to apply them to temp items
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
         set_sync_mode: function(mode) {
             this.sync_mode = mode;
             if (! this.isReady && mode !== "none")
                 this.init();
             if (mode == 'delayed') {
                 this.start_timer();
             } else {
                 this.stop_timer();
             }
         },

         /* Enqueue an obsel */
         enqueue: function(obsel) {
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
         init: function() {
             var self = this;
             if (this.isReady)
                 /* Already initialized */
                 return;
             if (this.mode == 'GET')
             {
                 var request=$('<img/>').attr('src', this.url + 'login?userinfo={"name":"ktbs4js"}');
                 // Do not wait for the return, assume it is
                 // initialized. This assumption will not work anymore
                 // if login returns some necessary information
                 this.isReady = true;
             }
             else
             {
                 $.ajax({ url: this.url + 'login',
                          type: 'POST',
                          data: 'userinfo={"name":"ktbs4js"}',
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
     var BufferedService = function(url, mode) {
         this.url = url;
         this.buffer = [];
         this.isReady = false;
         this.timer = null;
         this.failureCount = 0;
         // sync_mode is either "none", "sync" or "buffered"
         this.sync_mode = "none";
         /* mode can be either POST or GET */
         if (mode == 'POST' || mode == 'GET')
             this.mode = mode;
         else
             this.mode = 'POST';
         /* Flush buffer every timeOut ms if the sync_mode is delayed */
         this.timeOut = 2000;
     };
     BufferedService.prototype = BufferedService_prototype;

     var Trace_prototype = {
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
                 this.syncservice.set_sync_mode(mode);
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

     var Trace = function(uri, requestmode) {
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

         this.syncservice = new BufferedService(uri, requestmode);
         $(window).unload( function () {
                               if (this.syncservice && this.sync_mode !== 'none') {
                                   this.syncservice.flush();
                                   this.syncservice.stop_timer();
                               }
                           });
     };
     Trace.prototype = Trace_prototype;

     var Obsel_prototype = {
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
             /* FIXME: maybe we should return a ObselType object. In the meantime, return the URI */
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
                 if (this.hasOwnProperty(prop))
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
                 if (this.hasOwnProperty(prop))
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
                 "@i": this.id,
                 "@t": (this.trace.shorthands.hasOwnProperty(this.type) ? this.trace.shorthands[this.type] : this.type),
                 "@b": this.begin,
                 "@e": this.end,
                 "@s": this.subject
             };
             for (var prop in this.attributes) {
                 if (this.hasOwnProperty(prop))
                 {
                     var v = this.attributes[prop];
                     r[prop] = this.trace.shorthands.hasOwnProperty(v) ? this.trace.shorthands[v] : v;
                 }
             }
             return r;
         },

         toJSONstring: function() {
             return JSON.stringify(this.toJSON());
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
     Obsel.prototype = Obsel_prototype;

     var TraceManager_prototype = {
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
             if (window.console) window.console.log("init_trace", params);
             url = params.url ? params.url : "";
             requestmode = params.requestmode ? params.requestmode : "POST";
             syncmode = params.syncmode ? params.syncmode : "none";
             default_subject = params.default_subject ? params.default_subject : "default";
             var t = new Trace(url, requestmode);
             t.set_sync_mode(syncmode);
             t.set_default_subject(default_subject);
             this.traces[name] = t;
             return t;
         }
     };

     var TraceManager = function() {
         this.traces = {};
     };
     TraceManager.prototype = TraceManager_prototype;

     var tracemanager  = new TraceManager();
     /* FIXME: properly use require.js feature. This will do for debugging in the meantime */
     window.tracemanager = tracemanager;
 })(jQuery);
