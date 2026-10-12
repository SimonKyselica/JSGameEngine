import { AudioSource, Behaviour, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';

/**
 * Exercises audio sources, the audio API and asset lookups.
 *
 * Expects to sit on "Sfx", whose AudioSource holds `Sounds/beep.wav` and does not play
 * on start, next to an entity "Music" whose looping AudioSource does.
 */
export default class AudioProbe extends Behaviour implements ScriptLifecycle {
  onStart(): void {
    const test = harnessOf(this);
    const { audio, assets, entity } = this;

    const source = this.requireComponent(AudioSource);
    test.check(
      'AudioSource fields',
      source.clip !== null &&
        source.volume === 0.8 &&
        source.pitch === 1 &&
        !source.loop &&
        !source.playOnStart,
      // Says what is there, because this is the check that fails when the scene was edited.
      `expected a clip, volume 0.8, pitch 1, no loop and no play on start; found ${
        source.clip === null ? 'no clip' : 'a clip'
      }, volume ${source.volume}, pitch ${source.pitch}, loop ${source.loop}, play on start ${source.playOnStart}`,
    );

    const beep = assets.find('Sounds/beep.wav');
    test.check('AssetsApi.find by path', beep !== null && beep === source.clip);
    test.check(
      'AssetsApi.find by bare name and type',
      assets.find('beep', 'audio') === beep && assets.find('beep', 'texture') === null,
    );
    test.check('AssetsApi.exists', assets.exists('beep') && !assets.exists('no-such-asset'));
    test.check(
      'AssetsApi.getName',
      beep !== null &&
        assets.getName(beep) === 'Sounds/beep.wav' &&
        assets.getName('no-such-id') === null,
    );

    const music = this.scene.findByName('Music');
    const musicSource = music?.getComponent(AudioSource);
    test.check(
      'AudioSource.playOnStart starts playback',
      music !== null && audio.isPlaying(music) && musicSource?.loop === true,
    );

    test.check(
      'AudioApi.isPlaying is false before playing',
      !audio.isPlaying(entity),
      `"${entity.name}" is already playing, as it is when its Audio Source has Play On Start ticked`,
    );
    test.check('AudioApi.play', audio.play(entity) && audio.isPlaying(entity));
    audio.stop(entity);
    test.check('AudioApi.stop', !audio.isPlaying(entity));
    test.check('AudioApi.playOneShot', audio.playOneShot('Sounds/beep.wav', 0.5, 1.5));

    audio.masterVolume = 0.5;
    test.check('AudioApi.masterVolume', audio.masterVolume === 0.5);
    audio.masterVolume = 1;

    // The host checks that these reach the voice that is already playing.
    if (musicSource) {
      musicSource.volume = 0.25;
      musicSource.pitch = 1.5;
    }
  }
}
