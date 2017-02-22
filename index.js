var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

// New Code (for connecting to our MongoDB instance)
var mongo = require('mongodb');
var monk = require('monk');
var db = monk('localhost:27017/quiz-us');


var t; // Will eventually act as the interval timer
var users = 0;
var time_elapsed = 0; // in seconds

var questionPackage = {};
var questionDisplay = {};

var socketsToNicknames = {};
var nicknamesToScores = {};
var disconnectedNames = [];

var answersLeft = 0;


// refers to index.html file 
app.get('/', function(req, res) {
	res.sendFile(__dirname + '/index.html');
});



// TODO: (?) Allow someone to log back in and continue (?)



// Whenever a socket is formed (meaning a user connected):
io.on('connection', function(socket) {

	socket.on('nickname submission', function(nickname) {
		// Prepare and send to the newly connected client the question and progress
		var socketID = socket.id;

		if (!(nickname in nicknamesToScores)) {
			// Nickname is not already taken, proceed as normal

			socketsToNicknames[socketID] = nickname;
			nicknamesToScores[nickname] = 0;
			questionDisplay.clientID = nickname;
			questionDisplay.time_elapsed = time_elapsed;
			socket.emit('joined game', questionDisplay);

			// Emit to all clients the new number of users
			users++;
			io.emit('update count', users);
		} else {
			// Nickname is already taken, send message asking for a different one
			socket.emit('nickname taken');
		}

	});


	// When a correct answer is submitted
	socket.on('answer submission', function(input) {
		var index = indexOfAnswer(input);
		if (index > -1) {
			// Client submitted a correct answer
			answersLeft--;
			questionPackage.answered[index]= true;
			questionDisplay.groupScore++;

			// Update the package sent to new page openings
			var nextEmptyDisplayIndex = questionDisplay.answers.length - answersLeft - 1;
			questionDisplay.answers[nextEmptyDisplayIndex] = questionPackage.answers[index];

			// Update score
			nicknamesToScores[socketsToNicknames[socket.id]]++;

			// Notify all other clients of the new answer, including id of client that submitted it.
			var answerPackage = {"text" : questionPackage.answers[index], "index" : nextEmptyDisplayIndex, "clientID" : socketsToNicknames[socket.id]};
			io.emit('update answer', answerPackage);

			if (answersLeft == 0) {
				endQuestion();
			}
		} else {
			// Client submitted an incorrect answer
			socket.emit('wrong answer');
		}
	});


	// And when the socket disconnects
	socket.on('disconnect', function(){
		if (socketsToNicknames.hasOwnProperty(socket.id)) {
			disconnectedNames.push(socketsToNicknames[socket.id]);
			delete socketsToNicknames[socket.id];
			users--;
    		io.emit('update count', users);
		}
  	});

});

// Helper function that checks if submitted answer is valid (correct and previously unanswered)
function indexOfAnswer(input) {
	for (var i = 0; i < questionPackage.answers.length; i++) {
	  	if ((questionPackage.answers[i].toLowerCase() === input.toLowerCase()) && (questionPackage.answered[i] == false)) {
	  		console.log("It's correct.");
	    	return i;
	  	}
	}
	return -1;
}


function oneSecondFunction() {
	time_elapsed++;
	questionDisplay.time_elapsed = time_elapsed;
	io.emit('timer', time_elapsed);
}


function endQuestion() {
	clearInterval(t);
	if ((time_elapsed < questionPackage.record_time) || (questionPackage.record_time == -1)) {

		collection.findAndModify({_id: questionPackage['_id']}, { $set: {record_time : time_elapsed} });

	}

	time_elapsed = 0;
	if (temp_allQIDs.length == 0) {
		// With the false flag, it won't automatically initiate the first question and will instead
		// do it on the 3 second delay like we want - seamlessly
		setUpAllQuestions(false);
		temp_allQIDs = allQIDs;
	}	


	// Emit top scores
	var sortable = [];
	for (var nickname in nicknamesToScores) {
		sortable.push([nickname, nicknamesToScores[nickname]]);
	}
	sortable.sort(function(a, b) {return b[1] - a[1]});
	io.emit('final scores', sortable[0]);


	for (var i = 0; i < disconnectedNames.length; i++) {
		if (nicknamesToScores.hasOwnProperty(disconnectedNames[i])) {
			delete nicknamesToScores[disconnectedNames[i]];
		} 
	}
	disconnectedNames = [];

	setTimeout(startQuestion, 5000);
}

function startQuestion() {

	console.log("STARTED QUESTION");


	thisQID = temp_allQIDs.shift();
	time_elapsed = 0;
	console.log(thisQID);
	collection.findById(thisQID, function(err, doc) {
		setUpQP(doc);
		answersLeft = questionPackage.answers.length;

		// Reset all the scores back to 0
		for (var nickname in nicknamesToScores) {
		    if (nicknamesToScores.hasOwnProperty(nickname)) {
		        nicknamesToScores[nickname] = 0;
		    }
		}

		t = setInterval(oneSecondFunction, 1000);

		// Temporary solution to bug where record time won't update on webpage on new question
		questionDisplay.record_time = questionPackage.record_time;
		io.emit('new question', questionDisplay);
	});

}

// Creating the question package to be sent to users logging on mid-question
// Note, it does NOT contain any of the answers that have not been submitted yet
function setUpQP(dbObject) {
	questionPackage = dbObject;
	questionDisplay = {};
	questionDisplay['question'] = dbObject.question;
	questionDisplay.record_time = dbObject.record_time;
	questionDisplay.time_elapsed = 0;
	questionPackage.answered = [];
	questionDisplay.answers = [];

	for (var i = 0; i < dbObject.answers.length; i++) {
		questionPackage.answered[i] = false;
		questionDisplay.answers[i] = " ";

	}
	questionDisplay.groupScore = 0;
}

http.listen(3000, function() {
	console.log('listening on port 3000');
});


// Fischer-Yates Shuffling:
function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}


var allQIDs = [];
var temp_allQIDs = [];
var collection = db.get('questioncollection');

// > use quiz-us
// switched to db quiz-us
// > db.questioncollection.find().pretty()

function setUpAllQuestions(firstTime) {
	collection.find({}, {}, function(e, docs) {

		for (var i = 0; i < docs.length; i++) {
			allQIDs.push(docs[i]['_id']);
		}
		temp_allQIDs = shuffle(allQIDs);

		if (firstTime) {
			startQuestion();
		}
	});
}

// With the true flag, it will initiate the first question.
setUpAllQuestions(true);




