$(window).load(function() {
                   trace_cinecast = window.tracemanager.init_trace("festival", { url: "http://traces.advene.org:5000/",
                                                                                 requestmode: 'GET',
                                                                                 syncmode: 'sync' });
                   trace_cinecast.trace('SiteNavigate', { userid: userinfo ? userinfo.id : "anonymous",
                                                          currenturl: document.URL,
                                                          oldurl: document.referrer });
                   /*
                   $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                       .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                       .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
                    */
               });
