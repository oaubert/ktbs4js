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
