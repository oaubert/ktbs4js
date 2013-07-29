KTBS API for JavaScript
=======================

API for storing and accessing modelled traces in JavaScript.

It is based on the abstract client API defined in
https://github.com/ktbs/ktbs/blob/master/doc/source/concepts/abstract_api.rst

It can be used standalone, or use a trace storage system such as
https://github.com/oaubert/nots/ or https://github.com/ktbs/ktbs/

Usage
-----

The handshake parameter indicates wether a "login" method should be
called on the trace. Calling this method has 2 functions:

- when using POST requests, the synchronisation mechanism is activated
  only if this method returns a successful status.

- the default_subject information is passed along in its data. The
  trace server is then assumed to memorize this information, and the
  lib will not send it in future obsels when using the compact-json
  format.
