$(window).load(function() {
                   // Initialisation of default_subject is
                   // VodKaster-specific: other partners should modify
                   // the default_subject initialisation to get user-id
                   trace_cinecast = window.tracemanager.init_trace("festival", { url: "http://traces.advene.org:5000/",
                                                                                 requestmode: 'GET',
                                                                                 syncmode: 'sync',
                                                                                 default_subject: typeof(userInfo) != 'undefined' ? userInfo.id : 'anonymous' });
                   trace_cinecast.trace('SiteNavigate', { currenturl: document.URL,
                                                          oldurl: document.referrer });

                   /* Autres sondes a implementer:
                    * - UserLogin(userid, currenturl);
                    * - DoSearch(userid, currenturl, expression)
                    * - (AnnotationCreate(userid, currenturl, annotationid) -> derivable du mining des donnees)
                    * - CommentCreate(userid, currenturl, annotationid, commenturl)
                    * - AnnotationShare(userid, currenturl, annotationid, service)
                    */
                   /*
                   $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                       .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                       .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
                    */
               });
