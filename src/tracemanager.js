/* Modelled Trace API */
(function() {
     /* FIXME: Write proper representation functions (str, json, ...)
      */
     var Trace_prototype = {
         /* FIXME: We could/should use a sorted list such as
          http://closure-library.googlecode.com/svn/docs/class_goog_structs_AvlTree.html
          to speed up queries based on time */
         obsels: [],
         /* Trace URI */
         uri: "",
         sync_mode: "none",
         default_subject: "",
         /* baseuri is used a the base URI to resolve relative attribute names in obsels */
         baseuri: "",

         /* Define the trace URI */
         set_uri: function(uri) {
             this.uri = uri;
         },

         /* Sync mode: buffered, sync (immediate sync), none (no
          * synchronisation with server, the trace has to be explicitly saved
          * if needed */
         set_sync_mode: function(mode) {
             this.sync_mode = mode;
         },

         /*
          * Return a list of the obsels of this trace matching the parameters
          */
         list_obsels: function(begin, end, reverse) {
             var res;
             if (typeof begin !== 'undefined' || typeof end !== 'undefined') {
                 /*
                  * Not optimized yet.
                  */
                 res = [];
                 var l = this.obsels.length;
                 for (var i = 0; i < l; i++) {
                     var o = this.obsels[i];
                     if ((typeof begin !== 'undefined' && o.begin > begin) && (typeof end !== 'undefined' && o.end < end)) {
                         res.push(o);
                     }
                 }
             }

             if (typeof reverse !== 'undefined') {
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
         create_obsel: function(type, begin, end, subject, attributes) {
             var o = new Obsel(type, begin, end, subject);
             if (typeof attributes !== 'undefined') {
                 o.attributes = attributes;
             }
             o.trace = this;
             this.obsels.push(o);
         },

         /* Helper methods */

         /* Create a new obsel with the given attributes */
         trace: function(type, attributes, begin, end, subject) {
             var t = (new Date()).getTime();
             if (typeof begin === 'undefined') {
                 begin = t;
             }
             if (typeof end === 'undefined') {
                 end = begin;
             }
             if (typeof subject === 'undefined') {
                 subject = this.default_subject;
             }
             return this.create_obsel(type, begin, end, subject, attributes);
         }
     };

     var Trace = function(uri) {
         /* FIXME: We could/should use a sorted list such as
          http://closure-library.googlecode.com/svn/docs/class_goog_structs_AvlTree.html
          to speed up queries based on time */
         this.obsels = [];
         /* Trace URI */
         this.uri = "";
         this.sync_mode = "none";
         this.default_subject = "";
         /* baseuri is used a the base URI to resolve relative attribute names in obsels */
         this.baseuri = "";
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
         }
     };

     var Obsel = function(type, begin, end, subject, attributes) {
         this.trace = undefined;
         this.type = type;
         this.begin = begin;
         this.end = end;
         this.subject = subject;
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
          * Explicitly create and initialize a new trace "ldt"
          * If another existed with the same name before, then it is replaced by a new one.
          */
         init_trace: function(name) {
             var t = new Trace();
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
 })();
