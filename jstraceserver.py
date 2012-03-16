#! /usr/bin/python

import os
import json
import bson
import uuid
from optparse import OptionParser
from flask import Flask, Response
from flask import session, request, redirect, url_for, current_app, make_response, abort
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

# Server configuration
CONFIG = {
    # Enable debug. This implicitly disallows external access
    'enable_debug': False,
    # Run the server in external access mode (i.e. not only localhost)
    'allow_external_access': True,

    # Trace access control (for reading) is either:
    # 'none' -> no access
    # 'localhost' -> localhost only
    # 'any' -> any host
    'trace_access_control': 'none',
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

@app.errorhandler(401)
def custom_401(error):
    return Response('Unauthorized access', 401, {'WWWAuthenticate':'Basic realm="Login Required"'})

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
        response = make_response()
        response.headers['X-Obsel-Count'] = str(len(obsels))
        if request.method == 'GET':
            # GET methods are usually used to make cross-site
            # requests, and invoked through a <img> src
            # attribute. Let's return a pseudo-image.
            response.mimetype = 'image/png'
        else:
            response.data = "%d" % len(obsels)
        return response
    elif request.method == 'GET':
        if (CONFIG['trace_access_control'] == 'any'
            or (CONFIG['trace_access_control'] == 'localhost' and request.remote_addr == '127.0.0.1')):
            return ("""<b>Available subjects:</b>\n<ul>"""
                    + "\n".join("""<li><a href="%s">%s</a></li>""" % (s, s) for s in db['trace'].distinct('subject'))
                    + """</ul>""")
        else:
            abort(401)
    elif request.method == 'HEAD':
        if (CONFIG['trace_access_control'] == 'any'
            or (CONFIG['trace_access_control'] == 'localhost' and request.remote_addr == '127.0.0.1')):
            response = make_response()
            response.headers['X-Obsel-Count'] = str(db['trace'].count())
            return response
        else:
            abort(401)

@app.route('/trace/<path:info>', methods= [ 'GET', 'HEAD' ])
def trace_get(info):
    if CONFIG['trace_access_control'] == 'none':
        abort(401)
    if (CONFIG['trace_access_control'] == 'localhost' and request.remote_addr != '127.0.0.1'):
        abort(401)

    info = info.split('/')
    if len(info) == 1 or (len(info) == 2 and info[1] == ''):
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
    parser=OptionParser(usage="""Trace server.\n%prog [options]""")

    parser.add_option("-d", "--debug", dest="enable_debug", action="store_true",
                      help="Enable debug. This implicitly disallows external access.",
                      default=False)

    parser.add_option("-e", "--external", dest="allow_external_access", action="store_true",
                      help="Allow external access (from any host)", default=False)

    parser.add_option("-g", "--get-access-control",
                      action="store", type="choice", dest="trace_access_control",
                      choices=("none", "localhost", "any"), default='none',
                      help="""Control trace GET access. Values: none: no trace access; localhost: localhost only; any: any host can access""")

    (options, args) = parser.parse_args()
    if options.enable_debug:
        options.allow_external_access = False
    CONFIG.update(vars(options))

    if CONFIG['enable_debug']:
        app.run(debug=True)
    elif CONFIG['allow_external_access']:
        app.run(debug=False, host='0.0.0.0')
    else:
        app.run(debug=False)
