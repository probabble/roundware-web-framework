import * as turf from '@turf/turf'; // TODO try to use smaller packages since turf is so modular

const convertLinesToPolygon = shape => turf.lineToPolygon(shape);
const FADE_DURATION_SECONDS = 3;

/** A Roundware speaker under the control of the client-side mixer, representing 'A polygonal geographic zone within which an ambient audio stream broadcasts continuously to listeners. 
 * Speakers can overlap, causing their audio to be mixed together accordingly.  Volume attenuation happens linearly over a specified distance from the edge of the Speaker’s defined zone.'
 * (quoted from https://github.com/loafofpiecrust/roundware-ios-framework-v2/blob/client-mixing/RWFramework/RWFramework/Playlist/Speaker.swift)
 * */
export class SpeakerTrack {
  constructor({ audioCtx, listenerPoint, data }) {
    const {
      id: speakerId,
      maxvolume: maxVolume,
      minvolume: minVolume,
      attenuation_border,
      boundary,
      attenuation_distance: attenuationDistance,
      uri,
    } = data;

    this.audioCtx = audioCtx;
    this.speakerId = speakerId;
    this.maxVolume = maxVolume;
    this.minVolume = minVolume;
    this.attenuationDistanceKm = attenuationDistance / 1000;
    this.uri = uri;
    this.listenerPoint = listenerPoint;
    this.playing = false;

    this.attenuationBorderPolygon = convertLinesToPolygon(attenuation_border);
    this.attenuationBorderLineString = attenuation_border;

    this.outerBoundary = convertLinesToPolygon(boundary);
    this.currentVolume = 0;
  }

  outerBoundaryContains(point) {
    return turf.booleanPointInPolygon(point,this.outerBoundary);
  }

  attenuationShapeContains(point) {
    return turf.booleanPointInPolygon(point,this.attenuationBorderPolygon);
  }

  attenuationRatio(atPoint) {
    const distToInnerShapeKm = turf.pointToLineDistance(atPoint,this.attenuationBorderLineString,{ units: 'kilometers' });
    const ratio = 1 - (distToInnerShapeKm / this.attenuationDistanceKm);
    return ratio;
  }

  calculateVolume() {
    const { listenerPoint } = this;

    if (this.attenuationShapeContains(listenerPoint)) {
      return this.maxVolume;
    } else if (this.outerBoundaryContains(listenerPoint)) {
      const range = this.maxVolume - this.minVolume;
      const volumeGradient = this.minVolume + (range * this.attenuationRatio(listenerPoint));
      return volumeGradient;
    } else {
      return this.minVolume;
    }
  }

  // @see https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createGain
  buildAudio() {
    if (this.audio) return this.audio;

    const { audioCtx, uri } = this;

    const audio = new Audio(uri);
    audio.crossOrigin = 'anonymous';
    audio.loop = true;

    const audioSrc = audioCtx.createMediaElementSource(audio);
    const gainNode = audioCtx.createGain();

    audioSrc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    this.gainNode = gainNode;
    this.audio = audio;
    this.audioCtx = audioCtx;

    return this.audio;
  }

  updateListenerPoint(point) {
    this.listenerPoint = point;
    this.updateVolume();
  }

  updateVolume() {
    const newVolume = this.calculateVolume();

    this.currentVolume = newVolume;

    const secondsFromNow = this.audioCtx.currentTime + FADE_DURATION_SECONDS;

    this.buildAudio();
    this.gainNode.gain.linearRampToValueAtTime(newVolume,secondsFromNow);

    //console.info(`Setting '${this}' volume: ${newVolume.toFixed(2)} over ${FADE_DURATION_SECONDS} seconds`);

    return newVolume;
  }

  get logline() {
    return `${this} (${this.uri})`;
  }

  async play() {
    const newVolume = this.updateVolume();

    if (newVolume < 0.05) return;

    try {
      console.log('Playing',this.logline);
      await this.audio.play();
      this.playing = true;
    } catch(err) {
      console.error('Unable to play',this.logline,err);
    }
  }

  async pause() {
    if (!this.playing) return;
    
    try {
      console.log('Pausing',this.logline);
      await this.audio.pause();
      this.playing = false;
    } catch(err) {
      console.error('Unable to pause',this.logline,err);
    }
  }

  toString() {
    const { speakerId } = this;
    return `SpeakerTrack (${speakerId})`;
  }
}