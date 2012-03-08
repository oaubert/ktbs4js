#! /usr/bin/python

import os
import json
import bson
import uuid
from flask import Flask
from flask import session, request, redirect, url_for, current_app, make_response
import pymongo

# PARAMETRES
# DB = DataBase
# COL= Collection
DB   	  = 'ktbs'

# Pseudo-JSON compression data
VALUE_TABLE = {
    '@i': '@id',
    '@t': '@type',
    '@b': 'begin',
    '@e': 'end',
    '@s': 'subject',
}

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
    if 'userinfo' in session and 'name' in session['userinfo']:
        app.logger.debug("Already logged in")
    else:
        # 'userinfo' is either a (GET) named param, or a (POST) form
        # field, whose value contains JSON data with information about
        # the user
        params = request.values.get('userinfo', "{'name':'Anonymous'}")

        if 'userinfo' in session:
            # session was already initialized. Update its information.
            db['userinfo'].update( {"id", session['userinfo']['id']},
                                   json.loads(params) )
        else:
            session['userinfo'] = json.loads(params)
            session['userinfo'].setdefault('id', str(uuid.uuid1()))
            db['userinfo'].save(dict(session['userinfo']))

        app.logger.debug("Logged in as " + session['userinfo']['id'])
    return redirect(url_for('index'))

def iter_obsels(**kwd):
    for o in db['trace'].find(kwd):
        o['@id'] = o['_id']
        del o['_id']
        del o['_serverid']
        yield o

@app.route('/trace/', methods= [ 'POST', 'GET', 'HEAD' ])
def trace():
    if (request.method == 'POST' or 
        (request.method == 'GET' and 'data' in request.values)):
        # Handle posting obsels to the trace
        # FIXME: security issue -must check request.content_length
        if not 'userinfo' in session:
            # No explicit login. Generate a session id
            session['userinfo'] = {'id': str(uuid.uuid1())}
            db['userinfo'].save(dict(session['userinfo']))
        if request.method == 'POST':
            obsels = request.json
        else:
            data = request.values['data']
            if data.startswith('c['):
                # Data mangling here. Pseudo compression is involved.
                # Swap " and /. Note that we use unicode.translate, so we pass a dict mapping.
                data = data[1:].translate({ord(u'"'): u'/', ord(u'/'):u'"'})
                # Replace keys with matching values
                obsels = [ dict((VALUE_TABLE.get(k, k), v) for k, v in o.iteritems() )
                           for o in json.loads(data) ]
            else:
                obsels = json.loads(data)
        for obsel in obsels:
            obsel['_serverid'] = session['userinfo'].get('id', "");
            db['trace'].save(obsel)
        return "%d" % len(obsels)
    elif request.method == 'GET':
        return ("""<b>Available subjects:</b>\n<ul>"""
                + "\n".join("""<li><a href="%s">%s</a></li>""" % (s, s) for s in db['trace'].distinct('subject'))
                + """</ul>""")
    elif request.method == 'HEAD':
        response = make_response()
        response.headers['X-Obsel-Count'] = str(db['trace'].count())
        return response

@app.route('/trace/<path:info>', methods= [ 'GET', 'HEAD' ])
def trace_get(info):
    info = info.split('/')
    if len(info) == 1:
        # subject
        if request.method == 'HEAD':
            response = make_response()
            response.headers['X-Obsel-Count'] = str(db['trace'].find({'subject': info[0]}).count())
            return response
        return current_app.response_class( json.dumps({
                    "@context": [
                        "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                        #{ "m": "http://localhost:8001/base1/model1#" }
                    ],
                    "@id": ".",
                    "hasObselList": "",
                    'obsels': list(iter_obsels(subject=info[0])) },
                                                      indent=None if request.is_xhr else 2,
                                                      cls=MongoEncoder),
                                           mimetype='application/json')
    elif len(info) == 2:
        # subject, id
        return current_app.response_class( json.dumps({
                    "@context": [
                        "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                        #{ "m": "http://localhost:8001/base1/model1#" }
                    ],
                    "@id": ".",
                    "hasObselList": "",
                    'obsels': list(iter_obsels(_id=bson.ObjectId(info[1]))) },
                                                      indent=None if request.is_xhr else 2,
                                                      cls=MongoEncoder),
                                           mimetype='application/json')
    else:
        return "Got info: " + ",".join(info)

@app.route('/logout')
def logout():
    session.pop('userinfo', None)
    return redirect(url_for('index'))

# set the secret key.  keep this really secret:
app.secret_key = os.urandom(24)

if __name__ == "__main__":
    app.run(debug=True)
