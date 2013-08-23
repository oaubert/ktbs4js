// -*- coding: utf-8; -*-
/* Example ktbs4js usage */
require(['jquery', 'tracemanager'], function($, tracemanager) {
    $(window).load(function() {
        // Initialisation of default_subject is site-specific
        my_trace = tracemanager.init_trace("base", { url: "http://server.address/base/",
                                                     requestmode: 'POST',
                                                     syncmode: 'sync',
                                                     default_subject: typeof(userInfo) != 'undefined' ? userInfo.id : 'anonymous' });
        my_trace.trace('SiteNavigate', { currenturl: document.URL,
                                         oldurl: document.referrer });
        
        /* 
           As the userid has been specified as default_subject for the
           trace, it will be added to every collected obsel, there is
           no need to specify it on each call to my_trace.trace.
        */

        /* Usage with  jquery. Timestamps will be automatically be generated. */
        $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
            .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
            .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
    });
});
