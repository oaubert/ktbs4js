$(window).load(function() {
                   trace_cinecast = window.tracemanager.init_trace("festival", { url: "http://traces.advene.org:5000/",
                                                                                 requestmode: 'GET',
                                                                                 syncmode: 'sync' });
                   trace_cinecast.trace('SiteNavigate', { userid: typeof(userinfo) != "undefined" ? userinfo.id : "anonymous",
                                                          currenturl: document.URL,
                                                          oldurl: document.referrer });

                   /* Autres sondes � impl�menter:
                    * - UserLogin(userid, currenturl);
                    * - DoSearch(userid, currenturl, expression)
                    * - (AnnotationCreate(userid, currenturl, annotationid) -> d�rivable du mining des donn�es)
                    * - CommentCreate(userid, currenturl, annotationid, commenturl)
                    * - AnnotationShare(userid, currenturl, annotationid, service)
                    */
                   /*
                   $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                       .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                       .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
                    */
               });
