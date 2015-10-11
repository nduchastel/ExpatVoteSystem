var mongo = require('mongodb');
var validator = require('validator');
var child_process = require('child_process');

var Server = mongo.Server,
    Db = mongo.Db,
    BSON = mongo.BSONPure;

var server = new Server('localhost', 27017, {auto_reconnect: true});
db = new Db('voters', server);

db.open(function(err, db) {
    if(!err) {
        console.log("Connected to 'voter' database");
        db.collection('voters', {strict:true}, function(err, collection) {
            if (err) {
                console.log("The 'voters' collection doesn't exist. Creating it with sample data...");
                populateVoters();
            }
        });
    }
});

db.open(function(err, db) {
    if(!err) {
        console.log("Connected to 'voter links' database");
        db.collection('voters', {strict:true}, function(err, collection) {
            if (err) {
                console.log("The 'voter links' collection doesn't exist. Creating it with sample data...");
                populateLinks();
            }
        });
    }
});

function cmd_spawn(cmd, args, cb_stdout, cb_end) {
  console.log('starting command: ' + cmd);
  console.log('arguments are: ' + args);
  var spawn = require('child_process').spawn,
    child = spawn(cmd, args),
    me = this;
  me.exit = 0;  // Send a cb to set 1 when cmd exits
  child.stdout.on('data', function (data) { cb_stdout(me, data) });
  child.stdout.on('end', function () { cb_end(me) });
}

function cmd_exec(cmd, args, my_out, my_err) {
   child_process.exec(cmd, args,function(error, stdout, stderr){
       console.log(stdout);
       my_out = stdout;
       my_err = stderr;
   });
}

function log_console(cmd) {
  console.log('cmd is of type ' + typeof cmd);
  console.log('cmd = ' + cmd);
  console.log(cmd.stdout);
}

// create a new voter with public/private keys
// sample:
//   {
//      "name" : "Nicolas Duchastel de Montrouge",                 -- MANDATORY
//      "email" : "nduchast@hotmail.com",                          -- MANDATORY
//      "facebook" : "facebook.com/nicolas.duchasteldemontrouge",  -- optional
//      "twitter" : "@nduchast"                                    -- optional
//      "lastRiding" : "Hull-Aylmer",                              -- optional
//      "currentLocation" : {                                      -- optional
//          "city": "Woodinville",                                 -- any set of fields
//          "state" : "Washington",
//          "country" : "USA"
//      }
//   }
exports.createKeys = function(req, res) {
    var voter = req.body;
    console.log('Adding voter: ' + JSON.stringify(voter));

    // look for name
    if (!voter.hasOwnProperty('name')) {
       res.status(400).send('invalid voter information: missing voter name');
       return;
    }
    console.log("Voter's name is " + voter['name']);
    if (voter['name'].length < 1) {
       res.status(400).send('invalid voter information: empty voter name');
       return;
    }

    // check email
    if (!voter.hasOwnProperty('email')) {
       res.status(400).send('invalid voter information: missing email');
       return;
    }
    if (!validator.isEmail(voter['email'])) {
       res.status(400).send("invalid voter information: invalid email: '" + voter['email']+"'");
       return;
    }

    console.log('about to start key gen');

    // genrate key
    var me = new Object();
    keygen = new cmd_spawn('./genkey.sh', [voter.name, voter.email],
      function (me, data) {me.stdout += data.toString();},
      function (me) {me.exit = 1;}
    );
    console.log('me is of type ' + typeof(me));
    console.log("me keys are '" + Object.keys(me) +"'");
    Object.keys(me).forEach(function(key) {
      var val = me[key];
      console.log("key '" + key + "' is '" + val + "'");
    });

    console.log('done running');

    console.log("keygen is of type " + typeof keygen);
    console.log("object keys are '" + Object.keys(keygen) +"'");


    Object.keys(keygen).forEach(function(key) {
      var val = keygen[key];
      console.log("key '" + key + "' is '" + val + "'");
    });

    console.log('result is ' + keygen.exit);

    db.collection('voters', function(err, collection) {
        collection.insert(voter, {safe:true}, function(err, result) {
            if (err) {
                res.send({'error':'An error has occurred'});
                return;
            }
            console.log('Success: ' + JSON.stringify(result[0]));
            console.log('result is ' + result);
            res.send(result);
            return;
        });
    });
};

// sample request to certify someone else
//    {
//      "validator": {
//         "gpg_name" : "Gill Frank (some_email@gmail.com)",
//         "_id": "5567893"
//         "private_key" : "
//              -----BEGIN RSA PRIVATE KEY-----
//              MIIEpAIBAAKCAQEAy5q9/zTgeMXTj8Sj+gvv8ux9NeAhqZp8joYPo2vivA+oWqMD
//              …."
//      },
//      "certification" : "Canadian Expat Adult"
//    }
exports.certify = function(req, res) {
    var target_id = req.params.id;
    var j_req = req.body;

    console.log('Certifying: ' + JSON.stringify(j_req));

    var request = JSON.parse(j_req);
   
    var target = db.collection('voters', function(err, collection) {
        return collection.find({_id: target_id}).limit(1);
    });
    if (target.length < 1)
    {
      res.status(400).send('Voter to certified not found');
      return;
    }
    if (request.indexOf("validator")  < 0) {
       console.log('Cannot certify as validator is not defined!');
       res.status(404).send('missing validator');
       return;
    }
    if (request["validator"].indexOf("_id") < 0) {
       console.log('Cannot certify as id for validator  is not defined!');
       res.status(403).send('missing validator id');
       return;
    }
    var certifier = db.collection('links', function(err, collection) {
        var myId = request['validator']['_id'];
        return collection.find({_id: myId}).limit(1);
    });
    if (certifier.length < 1)
    {
      res.status(404).send('Voter which would certify not found');
      return;
    }
    db.collection('links', function(err, collection) {
       var link = {
          "validator" : {
             "_id": certifier['_id'],
             "name": certifier['name'],
             "email": certifier['email']
          },
          "target" : {
             "_id": target['_id'],
             "name": target['name'],
             "email": target['email']
          },
          "target" : "Canadian Expat Adult"
       };
       collection.insert(link, {safe:true}, function(err, result) {
         if (err) {
            console.log('ERROR: ' + certifier['name'] + ' was NOT able to certify that ' + target['name'] + ' is a Canadian Expat Adult');
            res.status(500, 'some unknown server error trying to add certification');
         } else {
            console.log(certifier['name'] + ' was able to certify that ' + target['name'] + ' is a Canadian Expat Adult');
         }
       });
    });
};

/*--------------------------------------------------------------------------------------------------------------------*/
// Populate database with sample data -- Only used once: the first time the application is started.
// You'd typically not find this code in a real-life app, since the database would already exist.
var populateVoters = function() {

    var masters = [
    {
	_id: "1",
        name: "Nicolas Duchastel de Montrouge",
        email: "nduchast@hotmail.com",
        facebook: "facebook.com/nicolas.duchasteldemontrouge",
        twitter: "@nduchast",
        last_riding: "Hull--Aylmer",
        current_location: {
           city: "Woodinville",
           state: "Washington",
           country: "USA"
        }
    },
    {
	_id: "2",
        name: "Gill Frank",
        email: "gill.a.frank@gmail.com",
        facebook: "facebook.com/gill.frank",
        twitter: "@1gillianfrank1",
        last_riding: "Toronto--Danforth",
        current_location: {
           city: "Itacha",
           state: "New York",
           country: "USA"
        }
    }];

    db.collection('voters', function(err, collection) {
        collection.insert(masters, {safe:true}, function(err, result) {});
    });
};


var populateLinks = function() {

    var base_links = [
    {
        validator: {
           _id: "1",
           name: "Nicolas Duchastel de Montrouge",
           email: "nduchast@hotmail.com"
        },
        target: {
           _id: "2",
           name: "Gill Frank",
           email: "gill.a.frank@hgmail.com"
        },
        certification: "Canadian Expat Adult"
    },
    {
        validator: {
           id: "2",
           name: "Gill Frank",
           email: "gill.a.frank@hgmail.com"
        },
        target: {
           id: "1",
           name: "Nicolas Duchastel de Montrouge",
           email: "nduchast@hotmail.com"
        },
        certification: "Canadian Expat Adult"
    }];

    db.collection('links', function(err, collection) {
        collection.insert(base_links, {safe:true}, function(err, result) {});
    });
};

