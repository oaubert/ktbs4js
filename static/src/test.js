$(window).load(function() {
                   console.log("Starting test")

                   tr = window.tracemanager.init_trace("test", {
                                                           url: "http://traces.advene.org:5000/",
                                                           requestmode: 'GET',
                                                           syncmode: "delayed",
                                                           default_subject: "ktbs4js"
                                                       });
                   tr.trace("StartTracing", { foo: "bar" });
                   for (var i = 0; i < 10; i++) {
                       tr.trace("Iteration", { index: i });
                   }
                   console.log(tr.list_obsels());

                   $('#b').bind('mouseover', function () { tr.trace('MouseOver', {widget: this.id}) } )
                       .bind('mouseout', function () { tr.trace('MouseOut', {widget: this.id}) } )
                       .bind('click', function () { tr.trace('Click', {widget: this.id}) } );
               });
