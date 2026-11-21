import re, sys, collections, openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
src, out = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src)['Songs']
rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2)]

def plain(s):  # site transliteration -> plain ASCII, long vowels collapsed
    s = s.lower()
    for a,b in (('aa','a'),('ee','i'),('ii','i'),('oo','u'),('uu','u')): s = s.replace(a,b)
    return s
def key(s):    # phonetic grouping key
    s = plain(s)
    s = re.sub(r'\(.*?\)', '', s).replace('hh','h').replace('ow','au')
    s = re.sub(r'([sbdktcgjp])h', r'\1', s).replace('w','v').replace('z','l')
    s = re.sub(r'[^a-z]', '', s)
    s = re.sub(r'm$', '', s); s = re.sub(r'[a]$', '', s)
    return s
def title(s): return ' '.join(w[:1].upper()+w[1:] for w in s.split())

# ---------- RAGA ----------
groups = collections.defaultdict(collections.Counter)
for r in rows:
    if r[3]: groups[key(r[3])][r[3].strip()] += 1
ALIAS = {}
for target, vs in {
 'Kamavardhani': 'Kamavardhini|Kmavardhani|Kamvardhani|Kamavardahani',
 'Saurashtram': 'Saurastra|Saurashtra|Saurstra|Saurashtram',
 'Simhendramadhyamam': 'Simhendramadhyam|Simendramadhyam|Simhendramdhyam|Simhendra Madhyamam',
 'Punnagavarali': 'Punnagvarali|Punagavarali', 'Nadanamakriya': 'Nadanamkriya', 'Madhyamavati': 'Madhyamavti|Madymavati',
 'Kharaharapriya': 'Kharharapriya', 'Shankarabharanam': 'Shankarabharana|Shankarbharana', 'Devagandhari': 'Devgandhari',
 'Anandabhairavi': 'Anndabhairavi', 'Kalyani': 'Kalyni', 'Nilambari': 'Nilambri', 'Yadukulakambhoji': 'Yaukulakambhoji',
 'Kedaragaula': 'Kedaragamula|Kedara Gaula', 'Janaranjani': 'Janaranajani', 'Gambhiranata': 'Gambhiranasta|Gambhiranattai',
 'Dhavalambari': 'Dhavlambari', 'Brindavani': 'Brndavani', 'Brindavana Saranga': 'Brindavan Sarang|Brndavanasaranga',
 'Amritavarshini': 'Amrtavarsani|Amrtavarsini', 'Amritavahini': 'Amrtavahini', 'Navaroj': 'Navroj', 'Yaman Kalyani': 'Yamankalyan',
 'Gauda Malhar': 'Gaudamalhar|Gauda Mallar', 'Kadanakutuhalam': 'Kadanakutuhala|Katanakutuhalam', 'Chalanata': 'Chalanattai',
 'Chenjurutti': 'Chenjuruti|Shenjuruti|Shenjurutti', 'Natakuranji': 'Nattakuranji', 'Kanada': 'Kanadda', 'Hamsagamini': 'Hamsagamani',
 'Begada': 'Begade', 'Gangeyabhushani': 'Gangayabhushani|Gangeyabhusani', 'Nasikabhushani': 'Nasikabhusani|Nasikabhusai',
 'Rishabhapriya': 'Risabhapriya', 'Shuddhasarang': 'Shuddhsarang', 'Shadvidhamargini': 'Sadvidhamargini|Shadvidamargini',
 'Chenchukambhoji': 'Shenchukambhoji', 'Dharmavati': 'Dhamavati', 'Shanmukhapriya': 'Shanmugapriya|Sanmukhapriya',
 'Mayamalavagaula': 'Mayamalava Gaula', 'Ritigaula': 'Riti Gaula', 'Narayanagaula': 'Narayana Gaula', 'Gaurimanohari': 'Gauri Manohari',
 'Chakravakam': 'Chakravaka', 'Mohanam': 'Mohana', 'Hindolam': 'Hindola', 'Sindhubhairavi': 'Sindu Bhairavi',
}.items():
    for v in vs.split('|'): ALIAS[v] = target
canon_raga = {}
for k, cnt in groups.items():
    best = cnt.most_common(1)[0][0]
    nm = plain(re.sub(r'\s*\(.*$', '', best)).strip(' .,')
    nm = nm.replace('shh','sh').replace('hh','h').replace('ow','au')
    nm = re.sub(r'c(?!h)', 'ch', nm)
    nm = title(nm); canon_raga[k] = ALIAS.get(nm, nm)
RAGAMALIKA = re.compile(r'r[a]+g[a]+m[a]+l[i]+k', re.I)
def std_raga(v):
    if not v or plain(v).strip(' .?') in ('unknown','none','not known','?'): return ''
    if RAGAMALIKA.search(plain(v)): return 'Ragamalika'
    return canon_raga[key(v)]
raga_keys = set(groups)

# ---------- TAALA ----------
BASE = {'adi':'Adi','ad':'Adi','di':'Adi','ai':'Adi','rupak':'Rupakam','rupaka':'Rupakam','capu':'Chapu','cap':'Chapu',
 'at':'Ata','ata':'Ata','atanta':'Atanta','gati':'','druvam':'Dhruva','tripu':'Triputa','triput':'Triputa','tript':'Triputa','tripta':'Triputa','tripuT':'Triputa',
 'trividi':'Trividi','jamp':'Jhampa','jampe':'Jhampa','jampa':'Jhampa','ek':'Eka','eka':'Eka','maty':'Matya','mate':'Matya','matt':'Matya','matte':'Matya',
 'desadi':'Desadi','desad':'Desadi','madyadi':'Madhyadi','madyad':'Madhyadi','druv':'Dhruva','druva':'Dhruva','cempat':'Chempada','cempt':'Chempada','cepmat':'Chempada',
 'jompat':'Jhompata','jampat':'Jhompata','bilandi':'Bilandi','pancamuki':'Panchamukhi','laksmis':'Lakshmisha','kaharva':'Kaharva','kaharvaadi':'Kaharva'}
JATI = {'tisram':'Tisra','catursra':'Chatusra','catusram':'Chatusra','tisra':'Tisra','t':'Tisra','catusra':'Chatusra','caturasra':'Chatusra','c':'Chatusra','kanda':'Khanda','k':'Khanda',
        'misra':'Misra','m':'Misra','sankirna':'Sankeerna','sankerna':'Sankeerna','s':'Sankeerna'}
def tk(w):
    w = plain(w); w = re.sub(r'([sbdktcgjp])h', r'\1', w); return re.sub(r'[^a-z]', '', w)
def look(d, w):
    for c in (w, re.sub(r'm$','',w), re.sub(r'a?m?$','',w), w+'a'):
        if c in d: return d[c]
    return None
GATI = re.compile(r'(tisra|kanda)\s*(nadai|gati)|^\(?(tisra|tisram|tisragati)\)?$')
MANUAL = {'deepcaandi of hindustaani (mishra caapu)':'Deepchandi (Misra Chapu)',
          'cowtaal (hindustani) or roopakam':'Chautal / Rupakam','raagavardhani (18 aksharas)':'Ragavardhani',
          'double beat, to single beat':'', '(cauka)':'', 'usually aadi':'Adi','aadi(usi)':'Adi',
          'aadi (1 beat rest)':'Adi','aadi (song begins after 1/2 beat)':'Adi','tala/adi':'Adi','tisram':'Tisra Eka','tisra':'Tisra Eka','tishram':'Tisra Eka',
          'tishra laghu':'Tisra Eka','tishra gati':'Tisra Nadai','tishra gati eka':'Eka (Tisra Nadai)','tisram, tisra eka':'Tisra Eka',
          'ata tala capu':'Ata / Chapu','kaharvaadi':'Kaharva','roopakam/aadi':'Rupakam / Adi','(tisragati)':'Tisra Nadai','(pan).':'',
          'aadi (tishra gati)':'Adi (Tisra Nadai)','aadi (tishram)':'Adi (Tisra Nadai)','aadi (tishra)':'Adi (Tisra Nadai)','adi (tishra nadai)':'Adi (Tisra Nadai)',
          'aadi (2 kalai)':'Adi (2 Kalai)','aadi (2-kalai)':'Adi (2 Kalai)'}
def mk(x):
    x = plain(x); x = re.sub(r'sh','s',x); x = re.sub(r'kh','k',x); return x.replace('ch','c')
MANUAL = {mk(k): v for k, v in MANUAL.items()}
NOTGIVEN = {'unknown','none','no given tala','given','?','/','(raga:',''}
def one(part):
    p = plain(part).strip(' ,.')
    p = re.sub(r'\b([tkcms])\.?/', r'\1 ', p)  # k/capu -> k capu
    p = re.sub(r'^/', '', p)
    p = re.sub(r'\b(jati|jaati|laghu|tala|of|hindustani)\b', ' ', p)
    w = [tk(x) for x in p.split() if tk(x)]
    if not w: return None
    jati = ''
    if len(w) > 1 and look(JATI, w[0]): jati = look(JATI, w.pop(0))
    b = ''.join(w)
    if b.startswith('kandacap') or b.startswith('kandcap'): return 'Khanda Chapu'
    if look(BASE, b): base = look(BASE, b)
    elif b.endswith('capu') and look(JATI, b[:-4]): jati, base = look(JATI, b[:-4]), 'Chapu'
    else: return None
    if base == 'Rupakam' and jati: base = 'Rupaka'
    return (jati+' '+base).strip()
def std_tala(v):
    if v is None: return '', 'Taala not given on site'
    raw = v.strip(); lo = plain(raw)
    lo2 = mk(raw)
    if lo2 in MANUAL: r = MANUAL[lo2]; return r, ('' if r else 'Taala not given on site')
    if lo.strip(' .') in NOTGIVEN: return '', 'Taala not given on site'
    bare = re.sub(r'\(.*?\)', '', raw)
    if RAGAMALIKA.search(lo) or (key(raw) in raga_keys and one(bare) is None):
        return '', 'Site lists a raga in the taala field'
    m = re.match(r'^(.*?)\s*\((.*)\)\s*$', lo2)
    main, paren = (m.group(1), m.group(2)) if m else (lo2, '')
    parts = [x for x in re.split(r',|/(?<![tkcms]/)|\bor\b', re.sub(r'\b([tkcms])\.?/', r'\1 ', main)) if x.strip(' ,.')]
    talas, quals = [], []
    for x in parts + ([paren] if paren else []):
        xs = x.strip(' ,.')
        g = re.search(r'(tisra|kanda)\s*(nadai|gati)', xs) or (re.fullmatch(r'(tisra|tisram|tisragati)', xs) and talas)
        if g: quals.append(('Tisra' if 'tisra' in xs else 'Khanda')+' Nadai'); continue
        k = re.search(r'(\d)\s*-?\s*kalai', xs)
        if k: quals.append(k.group(1)+' Kalai'); continue
        t = one(xs)
        if t:
            if t not in talas: talas.append(t)
        elif xs: quals.append('?'+xs)
    if not talas: return title(raw), 'Taala kept as on site (not recognised)'
    note = ''
    q = [x for x in quals if not x.startswith('?')]
    s = ' / '.join(talas) + (f" ({', '.join(q)})" if q else '')
    if any(x.startswith('?') for x in quals): note = 'Check: '+raw
    return s, note
LANG = lambda v: '' if not v else title(plain(v)).replace('Kannada','Kannada')

out_rows = []
for r in rows:
    num, code, ttl, raga, tala, comp, lang, link, st = r
    sr = std_raga(raga); stl, note = std_tala(tala)
    notes = [n for n in (note, '' if st=='OK' else st) if n]
    if not sr: notes.append('Raga not given on site')
    out_rows.append([num, code, ttl, sr, stl, comp, LANG(lang), link, raga or '', tala or '', '; '.join(notes)])

wb = Workbook(); s = wb.active; s.title = 'Songs'
s.append(['ID','Page code','Song title','Raga','Taala','Composer','Language','Link','Raga (as on site)','Taala (as on site)','Notes'])
for r in out_rows: s.append(r)
f = Font(name='Arial', size=10); hf = Font(name='Arial', size=10, bold=True, color='FFFFFF'); gf = Font(name='Arial', size=10, color='808080')
for row in s.iter_rows():
    for c in row: c.font = f
for c in s[1]: c.font = hf; c.fill = PatternFill('solid', start_color='305496')
for i, r in enumerate(out_rows, 2):
    c = s.cell(i, 8); c.hyperlink = r[7]; c.font = Font(name='Arial', size=10, color='0563C1', underline='single')
    s.cell(i,9).font = gf; s.cell(i,10).font = gf
for col, w in zip('ABCDEFGHIJK', [8,10,42,24,22,26,12,38,22,22,40]): s.column_dimensions[col].width = w
s.freeze_panes = 'A2'; s.auto_filter.ref = f'A1:K{len(out_rows)+1}'

# summary sheets
for name, colidx in (('Taala list', 4), ('Raga list', 3)):
    t = wb.create_sheet(name); t.append([name.split()[0], 'No. of songs'])
    cnt = collections.Counter(r[colidx] for r in out_rows if r[colidx])
    for i,(k,v) in enumerate(sorted(cnt.items(), key=lambda x:(-x[1], x[0])), 2):
        t.append([k, f'=COUNTIF(Songs!{"E" if colidx==4 else "D"}:{"E" if colidx==4 else "D"},A{i})'])
    for row in t.iter_rows():
        for c in row: c.font = f
    for c in t[1]: c.font = hf; c.fill = PatternFill('solid', start_color='305496')
    t.column_dimensions['A'].width = 34; t.column_dimensions['B'].width = 14; t.freeze_panes = 'A2'
a = wb.create_sheet('About')
for line in ['Source: https://www.karnatik.com/lyrics.shtml (%d songs), scraped 19 Nov 2026.' % len(out_rows),
  'ID = number in the song page URL (e.g. c1373.shtml -> 1373).',
  'Raga and Taala are standardised: spelling variants merged (e.g. aadi/Adi/ADi -> Adi; roopakam/rUpaka -> Rupakam; k/cApu, khaNDa caapu -> Khanda Chapu).',
  'Taala jati prefixes on the site (t/, c/, k/, m/, s/) are written out as Tisra, Chatusra, Khanda, Misra, Sankeerna. Plain "Chapu" is kept as on the site (jati not stated).',
  'Nadai/gati and kalai notes are kept in brackets, e.g. "Adi (Tisra Nadai)", "Adi (2 Kalai)".',
  'Raga names are plain-ASCII forms of the site spelling, with variants of the same name merged under the commonest spelling. Ragamalika in all spellings -> Ragamalika.',
  'The original site values are kept in the grey columns "Raga (as on site)" and "Taala (as on site)".',
  'Notes column flags blanks on the site, pages where the site put a raga name in the taala field, and dead links.']:
    a.append([line]); a.cell(a.max_row,1).font = f
a.column_dimensions['A'].width = 140
wb.save(out)
tc = collections.Counter(r[4] for r in out_rows); print(len(tc)); print(tc.most_common())
print('ragas', len(set(r[3] for r in out_rows)), 'from', len(set(r[8] for r in out_rows)))
print(collections.Counter(r[10] for r in out_rows).most_common(8))
