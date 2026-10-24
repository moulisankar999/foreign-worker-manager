import json,re,sys
o=json.load(open(sys.argv[1]))
s=o.get('message','') if isinstance(o,dict) else json.dumps(o)
m=re.search(r'RESULTS:(\[.*\])',s,re.S)
if not m: print(s[:3000]); sys.exit(1)
r=json.loads(m.group(1))
for x in r: print('PASS' if x['ok'] else 'FAIL', x['t'], '' if x['ok'] else x.get('v'))
print(sum(x['ok'] for x in r),'/',len(r))
