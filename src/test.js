(function() {
     tr = window.tracemanager.init_trace("test");
     tr.set_default_subject("oaubert");
     tr.trace("StartTracing", { foo: "bar" });
     for (var i = 0; i < 10; i++) {
         tr.trace("Iteration", { index: i });
     }
     tr.trace("EndTracing");
     console.log(tr.list_obsels());
 })();
