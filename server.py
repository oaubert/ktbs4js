#! /usr/bin/python

import os
import json
import uuid
from flask import Flask
from flask import session, request, redirect, url_for
import pymongo

# PARAMETRES
# DB = DataBase
# COL= Collection
DB   	  = 'ktbs'

connection = pymongo.Connection("localhost", 27017)
db = connection[DB]

app = Flask(__name__)

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

@app.route('/trace', methods= [ 'POST' ])
def trace():
    if request.method == 'POST':
        # Handle posting obsels to the trace
        # FIXME: security issue -must check request.content_length
        obsels = json.loads(request.data)
        for obsel in obsels:
            obsel['_serverid'] = session['userinfo']['id'];
            db['trace'].save(obsel)
        return "%d obsels stored" % len(obsels)

@app.route('/logout')
def logout():
    session.pop('userinfo', None)
    return redirect(url_for('index'))

# set the secret key.  keep this really secret:
app.secret_key = os.urandom(24)

if __name__ == "__main__":
    app.run(debug=True)
