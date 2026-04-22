var layoutBeam = require('./beam');
var getBarYAt = require('./get-bar-y-at');
var layoutTriplet = require('./triplet');

var layoutVoice = function (voice) {
	for (var i = 0; i < voice.beams.length; i++) {
		if (voice.beams[i].type === 'BeamElem') {
			layoutBeam(voice.beams[i]);
			moveDecorations(voice.beams[i]);
			// The above will change the top and bottom of the abselem children, so see if we need to expand our range.
			for (var j = 0; j < voice.beams[i].elems.length; j++) {
				voice.adjustRange(voice.beams[i].elems[j]);
			}
		}
	}

	// Align beams that have the alignbeams flag to the same vertical position.
	alignBeams(voice.beams);

	voice.staff.specialY.chordLines = setLaneForChord(voice.children);

	// Now we can layout the triplets
	for (i = 0; i < voice.otherchildren.length; i++) {
		var child = voice.otherchildren[i];
		if (child.type === 'TripletElem') {
			layoutTriplet(child);
			voice.adjustRange(child);
		}
	}
	voice.staff.top = Math.max(voice.staff.top, voice.top);
	voice.staff.bottom = Math.min(voice.staff.bottom, voice.bottom);
};

function moveDecorations(beam) {
	var padding = 1.5; // This is the vertical padding between elements, in pitches.
	for (var ch = 0; ch < beam.elems.length; ch++) {
		var child = beam.elems[ch];
		if (child.top) {
			// We now know where the ornaments should have been placed, so move them if they would overlap.
			var top = yAtNote(child, beam);
			for (var i = 0; i < child.children.length; i++) {
				var el = child.children[i];
				if (el.klass === 'ornament' && el.position !== 'below') {
					if (el.bottom - padding < top) {
						var distance = top - el.bottom + padding; // Find the distance that it needs to move and add a little margin so the element doesn't touch the beam.
						el.bottom += distance;
						el.top += distance;
						el.pitch += distance;
						top = child.top = el.top;
					}
				}
			}
		}
	}
}

function placeInLane(rightMost, relElem) {
	// These items are centered so figure the coordinates accordingly.
	// The font reports some extra space so the margin is built in.
	var xCoords = relElem.getChordDim();
	if (xCoords) {
		for (var i = 0; i < rightMost.length; i++) {
			var fits = rightMost[i] < xCoords.left;
			if (fits) {
				if (i > 0)
					relElem.putChordInLane(i);
				rightMost[i] = xCoords.right;
				return;
			}
		}
		// If we didn't return early, then we need a new row
		rightMost.push(xCoords.right);
		relElem.putChordInLane(rightMost.length - 1);
	}
}

function setLaneForChord(absElems) {
	// Criteria:
	// 1) lane numbers start from the bottom so that as many items as possible are in lane 0, closest to the music.
	// 2) a chord can have more than one line (for instance "C\nD") each line is a lane.
	// 3) if two adjoining items would touch then push the second one to the next lane.
	// 4) use as many lanes as is necessary to get everything to not touch.
	// 5) leave a margin between items, so use another lane if the chords would have less than a character's width.
	// 6) if the chord only has one character, allow it to be closer than if the chord has more than one character.
	var rightMostAbove = [0];
	var rightMostBelow = [0];
	var i;
	var j;
	var relElem;
	for (i = 0; i < absElems.length; i++) {
		for (j = 0; j < absElems[i].children.length; j++) {
			relElem = absElems[i].children[j];
			if (relElem.chordHeightAbove) {
				placeInLane(rightMostAbove, relElem);
			}
		}
		for (j = absElems[i].children.length - 1; j >= 0; j--) {
			relElem = absElems[i].children[j];
			if (relElem.chordHeightBelow) {
				placeInLane(rightMostBelow, relElem);
			}
		}
	}
	// If we used a second line, then we need to go back and set the first lines.
	// Also we need to flip the indexes of the names so that we can count from the top line.
	if (rightMostAbove.length > 1 || rightMostBelow.length > 1)
		setLane(absElems, rightMostAbove.length, rightMostBelow.length);
	return { above: rightMostAbove.length, below: rightMostBelow.length };
}

function numAnnotationsBelow(absElem) {
	var count = 0;
	for (var j = 0; j < absElem.children.length; j++) {
		var relElem = absElem.children[j];
		if (relElem.chordHeightBelow)
			count++;
	}
	return count;
}

function setLane(absElems, numLanesAbove, numLanesBelow) {
	for (var i = 0; i < absElems.length; i++) {
		var below = numAnnotationsBelow(absElems[i]);
		for (var j = 0; j < absElems[i].children.length; j++) {
			var relElem = absElems[i].children[j];
			if (relElem.chordHeightAbove) {
				relElem.invertLane(numLanesAbove);
				// } else if (relElem.chordHeightBelow) {
				// 	relElem.invertLane(below);
			}
		}
	}
}

function yAtNote(element, beam) {
	beam = beam.beams[0];
	return getBarYAt(beam.startX, beam.startY, beam.endX, beam.endY, element.x);
}

function alignBeams(beams) {
	// Collect beams that have alignbeams set, separated by type and stem direction.
	var graceUp = [];
	var graceDown = [];
	var regularUp = [];
	var regularDown = [];
	for (var i = 0; i < beams.length; i++) {
		var beam = beams[i];
		if (beam.type === 'BeamElem' && beam.alignbeams && beam.beams.length > 0) {
			if (beam.isgrace) {
				if (beam.stemsUp) graceUp.push(beam);
				else graceDown.push(beam);
			} else {
				if (beam.stemsUp) regularUp.push(beam);
				else regularDown.push(beam);
			}
		}
	}

	// Align each group independently.
	alignBeamGroup(graceUp, true);
	alignBeamGroup(graceDown, false);
	alignBeamGroup(regularUp, true);
	alignBeamGroup(regularDown, false);
}

function alignBeamGroup(beamGroup, stemsUp) {
	if (beamGroup.length < 2) return;

	// For stems-up, align to the highest beam position (largest Y).
	// For stems-down, align to the lowest beam position (smallest Y).
	var compare = stemsUp ? Math.max : Math.min;
	var targetY = beamGroup[0].beams[0].startY;
	for (var i = 1; i < beamGroup.length; i++) {
		targetY = compare(targetY, beamGroup[i].beams[0].startY);
	}

	for (i = 0; i < beamGroup.length; i++) {
		var beam = beamGroup[i];
		var delta = targetY - beam.beams[0].startY;
		if (delta === 0) continue;

		// Adjust all beam lines (main beam + additional beams for 16th, 32nd, etc.)
		for (var b = 0; b < beam.beams.length; b++) {
			beam.beams[b].startY += delta;
			beam.beams[b].endY += delta;
		}

		// Adjust stem endpoints using the stored references.
		if (beam.createdStems) {
			for (var s = 0; s < beam.createdStems.length; s++) {
				var stem = beam.createdStems[s];
				stem.pitch2 += delta;
				if (stem.pitch2 > stem.top)
					stem.top = stem.pitch2;
				if (stem.pitch2 < stem.bottom)
					stem.bottom = stem.pitch2;
			}
		}
	}
}

module.exports = layoutVoice;
