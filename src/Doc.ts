import './Doc.css';

import * as t from 'io-ts';
import PR from 'io-ts/lib/PathReporter';
import React, {createElement as ce, useState} from 'react';

const Morpheme = t.type({
  literal: t.string,
  pronunciation: t.string,
  lemmaReading: t.string,
  lemma: t.string,
  partOfSpeech: t.array(t.string),
  inflectionType: t.union([t.array(t.string), t.null]),
  inflection: t.union([t.array(t.string), t.null]),
});
const Cloze = t.type({left: t.string, cloze: t.string, right: t.string});
const ScoreHit = t.type({
  wordId: t.string,
  score: t.union([t.number, t.null]), // I hate it but JavaScript codec sends Infinity->null
  search: t.string,
  run: t.union([t.string, Cloze]),
  summary: t.string,
});
const Furigana = t.union([t.string, t.type({ruby: t.string, rt: t.string})]);
const Dict = t.type({
  line: t.string,
  furigana: t.array(t.array(Furigana)),
  bunsetsus: t.array(t.array(Morpheme)),
  dictHits: t.array(t.array(t.array(ScoreHit))),
});
const Lightweight =
    t.array(t.union([t.string, t.type({line: t.string, hash: t.string, furigana: t.array(t.array(Furigana))})]));

const DICT_PATH = '/dict-hits-per-line';

type IScoreHit = t.TypeOf<typeof ScoreHit>;
type IDict = t.TypeOf<typeof Dict>;
type DictData = (IDict|string)[];
type LightData = t.TypeOf<typeof Lightweight>;

export async function setupLightweightJson(docFilename: string): Promise<LightData|undefined> {
  const response = await fetch(DICT_PATH + '/' + docFilename);
  if (!response.ok) {
    console.error(`Failed to fetch ${docFilename}: ${response.statusText}`);
    return undefined;
  }
  const decoded = Lightweight.decode(await response.json());
  if (decoded._tag === 'Right') { return decoded.right; }
  console.error(PR.PathReporter.report(decoded))
  console.error(`Failed to decode ${docFilename}`);
  return undefined;
}

export async function setupMarkdown(docFilename: string): Promise<DictData|undefined> {
  const response = await fetch(DICT_PATH + '/' + docFilename);
  if (!response.ok) {
    console.error(`Failed to fetch ${docFilename}: ${response.statusText}`);
    return undefined;
  }
  const markdown = await response.text();
  const promises = markdown.split('\n').map(async s => {
    if (!s.includes('<line id="hash-')) { return s; }
    const hash = s.replace(/.*?<line id="hash-([^"]+)">.*/, '$1');
    const response = await fetch(`${DICT_PATH}/line-${hash}.json`);
    if (!response.ok) {
      console.error(`Failed to find sidecar for ${hash}`);
      return s;
    }
    const decoded = Dict.decode(await response.json());
    if (decoded._tag === 'Right') { return decoded.right; }
    console.error(PR.PathReporter.report(decoded))
    console.error(`Error decoding sidecar for ${hash}`);
    return s;
  });
  const parsed = Promise.all(promises);
  return parsed;
}
/*
Render text
Show dictionary hits upon click
Accept dictionary hits
Accept changes in reading & mass-apply them & apply them for future occurrences in this doc
*/

export interface DocProps {
  data: LightData|undefined
}

const HASH_TO_DICT: Map<string, IDict> = new Map();
async function getHash(hash: string): Promise<IDict|undefined> {
  const hit = HASH_TO_DICT.get(hash);
  if (hit) { return hit; }
  const response = await fetch(`/dict-hits-per-line/line-${hash}.json`);
  if (response.ok) {
    const decoded = Dict.decode(await response.json());
    if (decoded._tag === 'Right') {
      const dict = decoded.right;
      HASH_TO_DICT.set(hash, dict);
      return dict;
    } else {
      console.error(PR.PathReporter.report(decoded))
      console.error(`Error decoding dictionary results sidecar file`);
    }
  } else {
    console.error('Error requesting dictionary results sidecar file', response.statusText);
  }
  return undefined;
}

async function clickMorpheme(hash: string, morphemeIdx: number, setHits: SetState<PopupProps['hits']>): Promise<void> {
  const dict = await getHash(hash);
  setHits(dict?.dictHits[morphemeIdx] || []);
}

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

function renderLightweight(line: LightData[0], setHits: SetState<PopupProps['hits']>) {
  if (typeof line === 'string') { return line; }
  return ce(
      'line', {is: 'span', id: 'hash-' + line.hash},
      ...line.furigana.map(
          (f, fidx) =>
              typeof f === 'string'
                  ? ce('morpheme', {onClick: e => clickMorpheme(line.hash, fidx, setHits), is: 'span'}, f)
                  : ce('morpheme', {onClick: e => clickMorpheme(line.hash, fidx, setHits), is: 'span'},
                       ...f.map(r => typeof r === 'string' ? r : ce('ruby', null, r.ruby, ce('rt', null, r.rt))))));
}

interface PopupProps {
  hits: IScoreHit[][];
  hidden: boolean;
  setHidden: SetState<boolean>;
}
function Popup({
  hits,
  hidden,
  setHidden,
}: PopupProps) {
  if (hidden) { return ce('div', null); }
  const button = ce('button', {onClick: e => setHidden(true)}, 'X');
  return ce('div', {id: "dict-popup"}, button,
            ce('ul', null,
               ...hits.map(stops => ce('li', null, ce('ol', null, ...stops.map(hit => ce('li', null, hit.summary)))))));
}

export function Doc({data}: DocProps) {
  const [hits, setHits] = useState([] as PopupProps['hits']);
  const [hiddenPopup, setHiddenPopup] = useState(true);

  if (!data) { return ce('p', null, ''); }

  const setHitsOpenPopup: typeof setHits = (x) => {
    setHiddenPopup(false);
    setHits(x);
  };
  return ce('div', null, ce(Popup, {hits, hidden: hiddenPopup, setHidden: setHiddenPopup}),
            ...data.map(o => ce('p', null, renderLightweight(o, setHitsOpenPopup))));
}
