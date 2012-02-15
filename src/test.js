    $(window).load(function() {
                       console.log("Starting test")
                       tr = window.tracemanager.init_trace("test");
                       tr.set_sync_mode('sync');
                       tr.set_default_subject("oaubert");
                       tr.trace("StartTracing", { foo: "bar" });
                       for (var i = 0; i < 10; i++) {
                           tr.trace("Iteration", { index: i });
                       }
                       tr.trace("EndTracing");
                       console.log(tr.list_obsels());
                   });
