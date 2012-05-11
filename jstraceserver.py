#! /usr/bin/python

#
# This file is part of ktbs4js.
#
# ktbs4js is free software: you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# ktbs4js is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public
# License along with ktbs4js.  If not, see <http://www.gnu.org/licenses/>.
#

import os
import json
import bson
import uuid
import re
import datetime
import time
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
    # Note: in compact mode, @d is in fact the duration (end - begin)
    '@d': 'end',
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
        params = request.values.get('userinfo', "{'default_subject':'anonymous'}")

        if 'userinfo' in session:
            # session was already initialized. Update its information.
            db['userinfo'].update( {"id": session['userinfo']['id']},
                                   json.loads(params) )
        else:
            session['userinfo'] = json.loads(params)
            session['userinfo'].setdefault('id', str(uuid.uuid1()))
            db['userinfo'].save(dict(session['userinfo']))

        app.logger.debug("Logged in as " + session['userinfo']['id'])
    return redirect(url_for('index'))

def iter_obsels(cursor):
    for o in cursor:
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
                # Swap " and ;. Note that we use unicode.translate, so we pass a dict mapping.
                data = data[1:].translate({ord(u'"'): u';', ord(u';'):u'"'}).replace('%23', '#')
                # Replace keys with matching values
                obsels = [ dict((VALUE_TABLE.get(k, k), v) for k, v in o.iteritems() )
                           for o in json.loads(data) ]
                # Decode optional relative ends: if end is not
                # present, then it is the same as begin. If present,
                # it is encoded as duration.
                for o in obsels:
                    o['end'] = o.get('end', 0) + o['begin']
                    if not 'id' in o:
                        o['id'] = ""
                    if not 'subject' in o:
                        o['subject'] = session['userinfo'].get('default_subject', "anonymous")
            else:
                obsels = json.loads(data)
        for obsel in obsels:
            obsel['_serverid'] = session['userinfo'].get('id', "");
            db['trace'].save(obsel)
        response = make_response()
        response.headers['X-Obsel-Count'] = str(len(obsels))
        response.headers['Access-Control-Allow-Origin'] = '*'
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
                    + "\n".join("""<li><a href="%s">%s</a> (%d)</li>""" % (s, s, db['trace'].find({'subject': s}).count()) for s in db['trace'].distinct('subject'))
                    + """</ul>""")
        else:
            abort(401)
    elif request.method == 'HEAD':
        if (CONFIG['trace_access_control'] == 'any'
            or (CONFIG['trace_access_control'] == 'localhost' and request.remote_addr == '127.0.0.1')):
            response = make_response()
            count = db['trace'].count()
            response.headers['Content-Range'] = "items 0-%d/%d" % (max(count - 1, 0), count)
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        else:
            abort(401)

def ts_to_ms(ts, is_ending_timestamp=False):
    """Convert a timestamp to ms.
    
    This function supports a number of formats:
    * plain numbers (considered as ms)
    * YYYY/MM/DD

    Its behaviour may differ when considering start or end
    timestamps. is_ending_timestamp indicates when we are in the
    latter case.
    """
    if ts is None:
        return None

    try:
        ms = long(ts)
    except ValueError:
        m = re.match('(\d\d\d\d)/(\d\d?)/(\d\d?)', ts)
        if m is not None:
            l = [ int(n) for n in m.groups() ]
            d = datetime.datetime(*l)
            if is_ending_timestamp:
                # Ending timestamp: consider begin of following day
                # instead
                d = d + datetime.timedelta(1)
            ms = long(1000 * time.mktime(d.timetuple()))
        else:
            ms = None
    return ms
    
@app.route('/trace/<path:info>', methods= [ 'GET', 'HEAD' ])
def trace_get(info):
    if CONFIG['trace_access_control'] == 'none':
        abort(401)
    if (CONFIG['trace_access_control'] == 'localhost' and request.remote_addr != '127.0.0.1'):
        abort(401)

    # For paging: http://stackoverflow.com/questions/5049992/mongodb-paging
    # Parameters: page / pageSize or from=timestamp / to=timestamp
    # In the first case (page), the returned Content-Range will indicate 
    #  items start-end/total
    # In the second case (from/to), the returned Content-Range will indicate
    #  items 0-(count-1)/total
    # where total is the total number of obsels in the given subject's trace
    # and count is the number of items matching the request
        
    # TODO: Find a way to return a summarized representation if interval is too large.
    from_ts = ts_to_ms(request.values.get('from', None))
    to_ts = ts_to_ms(request.values.get('to', None), True)
    page_number = request.values.get('page', None)
    if page_number is not None:
        page_number = long(page_number)
    page_size = request.values.get('pageSize', 100)
    if page_size is not None:
        page_size = long(page_size)
    info = info.split('/')
    if len(info) == 1 or (len(info) == 2 and info[1] == ''):
        # subject
        total = db['trace'].find({'subject': info[0]}).count()
        if page_number is not None:
            # User requested a specific page number.
            i = page_number * page_size
            if i > total:
                # Requested Range Not Satisfiable
                abort(416)
            else:
                if request.method == 'HEAD':
                    response = make_response()
                    end = min(i + page_size, total)
                    response.headers['Content-Range'] = "items %d-%d/%d" % (i, max(end - 1, 0), total)
                    response.headers['Access-Control-Allow-Origin'] = '*'
                    return response
                else:
                    # Note: if we use the common codepath (just
                    # setting cursor), then the Content-Range will
                    # start at 0 -> wrong info. So we have to generate
                    # the response here
                    cursor = db['trace'].find({'subject': info[0]}).skip(i).limit(page_number)
                    count = cursor.count()
                    response = current_app.response_class( json.dumps({
                                "@context": [
                                    "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                                    #{ "m": "http://localhost:8001/base1/model1#" }
                                    ],
                                "@id": ".",
                                "hasObselList": "",
                                'obsels': list(iter_obsels(cursor)) },
                                                                  indent=None if request.is_xhr else 2,
                                                                  cls=MongoEncoder),
                                                           mimetype='application/json')
                    response.headers['Content-Range'] = "items %d-%d/%d" % (i, i + count, total)
                    return response
        elif from_ts is not None:
            if to_ts is None:
                # Only > from_ts
                cursor = db['trace'].find({ 'subject': info[0],
                                            'begin': { '$gt': from_ts } })
            else:
                cursor = db['trace'].find({ 'subject': info[0],
                                            'begin': { '$gt': from_ts },
                                            'end': { '$lt': to_ts } })
        else:
            # No restriction. Count all obsels.
            cursor = db['trace'].find({ 'subject': info[0] })

        count = cursor.count()
        if request.method == 'HEAD':
            response = make_response()
            response.headers['Content-Range'] = "items 0-%d/%d" % (max(count - 1, 0), total)
            return response
        else:
            if count > 2000 and from_ts is None and to_ts is None and page_number is None:
                # No parameters were specified and the result is too large. Return a 
                # 413 Request Entity Too Large
                abort(413)
            response = current_app.response_class( json.dumps({
                        "@context": [
                            "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                            #{ "m": "http://localhost:8001/base1/model1#" }
                            ],
                        "@id": ".",
                        "hasObselList": "",
                        'obsels': list(iter_obsels(cursor)) },
                                                          indent=None if request.is_xhr else 2,
                                                          cls=MongoEncoder),
                                                   mimetype='application/json')
            response.headers['Content-Range'] = "items 0-%d/%d" % (max(count - 1, 0), total)
            return response
    elif len(info) == 2:
        # subject, id
        return current_app.response_class( json.dumps({
                    "@context": [
                        "http://liris.cnrs.fr/silex/2011/ktbs-jsonld-context",
                        #{ "m": "http://localhost:8001/base1/model1#" }
                    ],
                    "@id": ".",
                    "hasObselList": "",
                    'obsels': list(iter_obsels(db['trace'].find( { '_id': bson.ObjectId(info[1]) }))) },
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

    print "Options:"
    for k, v in CONFIG.iteritems():
        print " %s: %s" % (k, str(v))
    print

    if CONFIG['enable_debug']:
        app.run(debug=True)
    elif CONFIG['allow_external_access']:
        app.run(debug=False, host='0.0.0.0')
    else:
        app.run(debug=False)
