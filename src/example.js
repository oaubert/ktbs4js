// -*- coding: utf-8; -*-
require(['jquery', 'tracemanager'], function($, tracemanager) {
            $(window).load(function() {
                   // Initialisation of default_subject is
                   // VodKaster-specific: other partners should modify
                   // the default_subject initialisation to get user-id
                   trace_cinecast = tracemanager.init_trace("festival", { url: "http://traces.advene.org:5000/",
                                                                          requestmode: 'GET',
                                                                          syncmode: 'sync',
                                                                          default_subject: typeof(userInfo) != 'undefined' ? userInfo.id : 'anonymous' });
                   trace_cinecast.trace('SiteNavigate', { currenturl: document.URL,
                                                          oldurl: document.referrer });

                   /* Autres sondes à implémenter:
                    * - UserLogin(userid, currenturl);
                    * - DoSearch(userid, currenturl, expression)
                    * - (AnnotationCreate(userid, currenturl, annotationid) -> dérivable du mining des données)
                    * - CommentCreate(userid, currenturl, annotationid, commenturl)
                    * - AnnotationShare(userid, currenturl, annotationid, service)
                    *
                    * Note: cette notation traduit les types
                    * d'observés ainsi que les attributs
                    * associés pour les obsels qui seront obtenus.
                    *
                    * Au niveau de la collecte, comme le userid est
                    * spécifié comme default_subject pour la trace, il
                    * sera associé à chaque obsel. Il est donc inutile
                    * de le spécifier lors de l'appel à trace().
                    */
                   /*
                    * Exemple d'utilisation avec jquery:
                    $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                    .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                    .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
                    */
               });
        });
