$(window).load(function() {
                   trace_cinecast = window.tracemanager.init_trace("festival", { url: "http://traces.advene.org:5000/",
                                                                                 requestmode: 'GET',
                                                                                 syncmode: 'sync',
                                                                                 default_subject: userInfo ? userInfo.id : 'anonymous' });
                   trace_cinecast.trace('SiteNavigate', { currenturl: document.URL,
                                                          oldurl: document.referrer });

                   /* Autres sondes à implementer:
                    * - UserLogin(userid, currenturl);
                    * - DoSearch(userid, currenturl, expression)
                    * - (AnnotationCreate(userid, currenturl, annotationid) -> dérivable du mining des donnees)
                    * - CommentCreate(userid, currenturl, annotationid, commenturl)
                    * - AnnotationShare(userid, currenturl, annotationid, service)
                    */
                   /*
                   $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                       .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                       .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
                    */
               });
