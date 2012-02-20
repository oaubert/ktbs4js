#! /usr/bin/python

import os
import json
import bson
import uuid
from flask import Flask
from flask import session, request, redirect, url_for, jsonify, current_app
import pymongo

# PARAMETRES
# DB = DataBase
# COL= Collection
DB   	  = 'ktbs'

connection = pymongo.Connection("localhost", 27017)
db = connection[DB]

app = Flask(__name__)

class MongoEncoder(json.JSONEncoder):
    def default(self, obj, **kwargs):
        if isinstance(obj, bson.ObjectId):
            return str(obj)
        else:            
            return json.JSONEncoder.default(obj, **kwargs)

@app.route("/")
def index():
    if 'userinfo' in session:
        #return 'Logged in as : %s' % escape(session['navigator'])
        #session['navigator']['id']="test";
        return "Logged in as " + session['userinfo']['id']
    return 'You are not logged in'

@app.route('/login', methods = ['GET', 'POST'])
def login():
    if 'userinfo' in session:
        app.logger.debug("Already logged in")
    else:
        # 'userinfo' is either a (GET) named param, or a (POST) form
        # field, whose value contains JSON data with information about
        # the user
        params = request.values.get('userinfo', "{'name':'Anonymous'}")
        session['userinfo'] = json.loads(params)

        session['userinfo']['id'] = str(uuid.uuid1())
        dictform = dict(session['userinfo'])
        db['userinfo'].save(dictform)
        
        app.logger.debug("Logged in as " + session['userinfo']['id'])
    return redirect(url_for('index'))

def iter_obsels():
    for o in db['trace'].find():
        o['@id'] = o['_id']
        del o['_id']
        del o['_serverid']
        yield o

@app.route('/trace', methods= [ 'POST', 'GET' ])
def trace():
    if request.method == 'POST':
        # Handle posting obsels to the trace
        # FIXME: security issue -must check request.content_length
        obsels = json.loads(request.data)
        for obsel in obsels:
            obsel['_serverid'] = session['userinfo']['id'];
            db['trace'].save(obsel)
        return "%d obsels stored" % len(obsels)
    elif request.method == 'GET':
        return current_app.response_class( json.dumps({ 
                    "@context": [
                        "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                        #{ "m": "http://localhost:8001/base1/model1#" }
                        ],
                    "@id": ".",
                    "hasObselList": "",
                    'obsels': list(iter_obsels()) },
                                                      indent=None if request.is_xhr else 2,
                                                      cls=MongoEncoder), 
                                           mimetype='application/json')

@app.route('/logout')
def logout():
    session.pop('userinfo', None)
    return redirect(url_for('index'))

# set the secret key.  keep this really secret:
app.secret_key = os.urandom(24)

if __name__ == "__main__":
    app.run(debug=True)
