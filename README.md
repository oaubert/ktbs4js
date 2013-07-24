KTBS API for JavaScript
=======================

API for storing and accessing modelled traces in JavaScript.

It is based on the abstract client API defined in
https://github.com/ktbs/ktbs/blob/master/doc/source/concepts/abstract_api.rst

It also provides a trace server using MongoDB for storage, which is
able to store real-time traces of multiple clients using interactive
applications.

How To 
-------

### Setup it

You need to install : 
* mongo DB     (http://www.mongodb.org/) [ on Debian/Ubuntu: mongodb-server ]
* python pymongo module                  [ on Debian/Ubuntu: python-pymongo ]
* python 2.7   (http://python.org/)
* flask        (http://flask.pocoo.org/) [ on Debian/Ubuntu: python-flask ]

### Run it

* If MongoDB is not started, start it with the command: "mongod" (or see you distribution informations about services)
* Start the Server with the commmand : "python jstraceserver.py"
* To test it, open your browser and go to : (http://127.0.0.1:5000/static/test.html)

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
