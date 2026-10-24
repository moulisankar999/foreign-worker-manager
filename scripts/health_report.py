#!/usr/bin/env python3
"""Scheduled health report for FW Manager's CEO "Software Control" board (run by .github/workflows/health-report.yml).

Collects what only GitHub / Apple can tell us — TestFlight build state, Apple distribution certificate and App Store
profile expiry, GitHub Actions results, SSL certificate expiry, which GitHub secrets are present — and POSTs the
results to the Supabase `health-check` function. The repository is PUBLIC, so this script prints nothing but a
one-line summary: never a secret, a token, or the results themselves.
"""
import datetime as dt, json, os, socket, ssl, sys, time, urllib.request, urllib.error

APP_ID = '6826359279'
REPO = os.environ.get('GITHUB_REPOSITORY', 'moulisankar999/foreign-worker-manager')
SITE_HOST = 'fw.sunrisebayumas.com'
NOW = dt.datetime.now(dt.timezone.utc)
items = []

def add(key, status, title, summary, advice, area, detail=None, sort=100):
    items.append(dict(key='gh_' + key, status=status, title=title, summary=summary, advice=advice, area=area, detail=detail or {}, sort=sort))

def days_left(iso):
    t = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return (t - NOW).days, t

def fmt(t):
    return t.astimezone(dt.timezone(dt.timedelta(hours=8))).strftime('%d %b %Y')

def countdown(n):
    return 'red' if n < 14 else 'amber' if n < 60 else 'green'

def http_json(url, headers=None, data=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status, json.loads(r.read() or b'null')

def app_version():
    try:
        return json.load(open('package.json'))['version']
    except Exception:
        return None

VERSION = app_version()

# ------------------------------------------------------------------ Apple (App Store Connect API)
def asc_token():
    import jwt  # PyJWT
    key = os.environ.get('ASC_KEY_P8', '')
    if not key or not os.environ.get('ASC_KEY_ID') or not os.environ.get('ASC_ISSUER_ID'):
        return None
    return jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 900, 'aud': 'appstoreconnect-v1'},
                      key, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})

def asc(path, tok):
    return http_json('https://api.appstoreconnect.apple.com/v1/' + path, {'Authorization': 'Bearer ' + tok})[1]

def apple_checks():
    try:
        tok = asc_token()
    except Exception as e:
        tok = None
    if not tok:
        for k, t, s in (('testflight', 'iOS TestFlight build', 40), ('apple_cert', 'Apple distribution certificate', 130), ('apple_profile', 'App Store provisioning profile', 135)):
            add(k, 'grey', t, 'Apple could not be checked: the App Store Connect API key is not available to the workflow.',
                'Check GitHub → Settings → Secrets → Actions: ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID.', 'GitHub Actions secrets', sort=s)
        return
    # TestFlight: newest build
    try:
        d = asc(f'builds?filter[app]={APP_ID}&sort=-uploadedDate&limit=1&include=preReleaseVersion&fields[builds]=version,processingState,uploadedDate,expired,expirationDate&fields[preReleaseVersions]=version', tok)
        b = d['data'][0]['attributes']
        mv = next((i['attributes']['version'] for i in d.get('included', []) if i['type'] == 'preReleaseVersions'), '?')
        st = b.get('processingState')
        status = 'green' if st == 'VALID' and not b.get('expired') else 'amber' if st == 'PROCESSING' else 'red'
        behind = VERSION and mv != VERSION
        if status == 'green' and behind:
            status = 'amber'
        exp_n, exp_t = days_left(b['expirationDate']) if b.get('expirationDate') else (None, None)
        if status == 'green' and exp_n is not None and exp_n < 14:
            status = 'amber'
        add('testflight', status, 'iOS TestFlight build',
            f'Newest build: version {mv} build {b.get("version")} — {st}{" (expired)" if b.get("expired") else ""}'
            + (f', uploaded {fmt(days_left(b["uploadedDate"])[1])}' if b.get('uploadedDate') else '')
            + (f'; testers can install it for {exp_n} more day(s).' if exp_n is not None else '.')
            + (f' The app is now {VERSION}.' if behind else ''),
            'Nothing to do.' if status == 'green' else
            'Apple is still processing the build — check again in 15–30 minutes.' if st == 'PROCESSING' else
            'Run GitHub → Actions → iOS TestFlight → Run workflow to upload a fresh build.' if behind or (exp_n is not None and exp_n < 14) else
            'Apple rejected the build. Open App Store Connect → TestFlight → the build to read why, fix it, and re-run the iOS TestFlight workflow.',
            'App Store Connect → TestFlight (group "Team")', dict(version=mv, build=b.get('version'), state=st, expires_days=exp_n), 100)
    except Exception as e:
        add('testflight', 'grey', 'iOS TestFlight build', 'Could not read TestFlight builds (' + type(e).__name__ + ').', 'Try again later.', 'App Store Connect', sort=100)
    # distribution certificate
    try:
        certs = [c['attributes'] for c in asc('certificates?filter[certificateType]=DISTRIBUTION&fields[certificates]=name,expirationDate,serialNumber', tok)['data']]
        if not certs:
            add('apple_cert', 'red', 'Apple distribution certificate', 'No Apple Distribution certificate exists.', 'Create one (see Know-how → Rebuild steps) and update the IOS_DIST_P12_B64 / IOS_DIST_P12_PASSWORD GitHub secrets.', 'Apple Developer → Certificates', sort=130)
        else:
            c = max(certs, key=lambda c: c['expirationDate'])
            n, t = days_left(c['expirationDate'])
            add('apple_cert', countdown(n), 'Apple distribution certificate',
                f'{n} day(s) left — "{c["name"]}" expires {fmt(t)}.',
                'Nothing to do yet.' if n >= 60 else 'Create a new Apple Distribution certificate, export it as .p12 and replace the IOS_DIST_P12_B64 and IOS_DIST_P12_PASSWORD GitHub secrets, then re-create the App Store profile.',
                'Apple Developer → Certificates, Identifiers & Profiles', dict(expires=c['expirationDate'], days=n), 130)
    except Exception as e:
        add('apple_cert', 'grey', 'Apple distribution certificate', 'Could not read certificates (' + type(e).__name__ + ').', 'Try again later.', 'App Store Connect API', sort=130)
    # App Store provisioning profile
    try:
        profs = [p['attributes'] for p in asc('profiles?filter[profileType]=IOS_APP_STORE&fields[profiles]=name,profileState,expirationDate', tok)['data']]
        p = max(profs, key=lambda p: p['expirationDate']) if profs else None
        if not p:
            add('apple_profile', 'red', 'App Store provisioning profile', 'No App Store provisioning profile exists.', 'Create one for com.moulisankar.fwmanager and update the IOS_PROFILE_B64 GitHub secret.', 'Apple Developer → Profiles', sort=135)
        else:
            n, t = days_left(p['expirationDate'])
            st = 'red' if p['profileState'] != 'ACTIVE' else countdown(n)
            add('apple_profile', st, 'App Store provisioning profile',
                f'{n} day(s) left — "{p["name"]}" ({p["profileState"]}) expires {fmt(t)}.',
                'Nothing to do yet.' if st == 'green' else 'Re-generate the App Store profile in Apple Developer → Profiles, then replace the IOS_PROFILE_B64 GitHub secret.',
                'Apple Developer → Profiles', dict(expires=p['expirationDate'], days=n, state=p['profileState']), 135)
    except Exception as e:
        add('apple_profile', 'grey', 'App Store provisioning profile', 'Could not read profiles (' + type(e).__name__ + ').', 'Try again later.', 'App Store Connect API', sort=135)

# ------------------------------------------------------------------ GitHub Actions
def actions_check():
    tok = os.environ.get('GH_TOKEN', '')
    try:
        _, d = http_json(f'https://api.github.com/repos/{REPO}/actions/runs?per_page=50', {**({'Authorization': 'Bearer ' + tok} if tok else {}), 'Accept': 'application/vnd.github+json', 'User-Agent': 'fw-manager-health'})
        latest = {}
        for r in d.get('workflow_runs', []):
            if r['status'] != 'completed' or r['name'] in latest:
                continue
            latest[r['name']] = dict(conclusion=r['conclusion'], at=r['updated_at'], run=r['run_number'], url=r['html_url'])
        bad = [n for n, r in latest.items() if r['conclusion'] not in ('success', 'skipped', 'neutral')]
        add('actions', 'red' if 'iOS TestFlight' in bad else 'amber' if bad else 'green', 'GitHub Actions (build robots)',
            ('Last run failed: ' + ', '.join(bad) + '.') if bad else 'Last run of every workflow succeeded (' + ', '.join(f'{n} #{r["run"]}' for n, r in latest.items()) + ').',
            'Open GitHub → Actions → the failed workflow → read the red step, fix, then "Re-run jobs".' if bad else 'Nothing to do.',
            f'github.com/{REPO}/actions', dict(workflows=latest), 140)
    except Exception as e:
        add('actions', 'grey', 'GitHub Actions (build robots)', 'Could not read workflow runs (' + type(e).__name__ + ').', 'Try again later.', 'GitHub', sort=140)

# ------------------------------------------------------------------ SSL certificate of the website
def ssl_check():
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((SITE_HOST, 443), timeout=20) as s, ctx.wrap_socket(s, server_hostname=SITE_HOST) as t:
            c = t.getpeercert()
        exp = dt.datetime.fromtimestamp(ssl.cert_time_to_seconds(c['notAfter']), dt.timezone.utc)
        n = (exp - NOW).days
        issuer = dict(x[0] for x in c.get('issuer', ())).get('organizationName', '?')
        # GitHub Pages renews Let's Encrypt certificates itself ~30 days before expiry, so warn later than usual
        st = 'red' if n < 7 else 'amber' if n < 20 else 'green'
        add('ssl', st, 'HTTPS certificate (fw.sunrisebayumas.com)', f'Valid — {n} day(s) left, issued by {issuer}, expires {fmt(exp)}. GitHub Pages renews it automatically.',
            'Nothing to do.' if st == 'green' else 'Automatic renewal seems stuck: GitHub → repo Settings → Pages → remove and re-add the custom domain fw.sunrisebayumas.com, keep "Enforce HTTPS" on, and check the DNS tile.',
            'GitHub Pages (Let\'s Encrypt)', dict(expires=exp.isoformat(), days=n, issuer=issuer), 128)
    except ssl.SSLCertVerificationError as e:
        add('ssl', 'red', 'HTTPS certificate (fw.sunrisebayumas.com)', 'The certificate is invalid or expired — browsers show a security warning.', 'GitHub → repo Settings → Pages → re-add the custom domain and enable "Enforce HTTPS".', 'GitHub Pages', sort=128)
    except Exception as e:
        add('ssl', 'grey', 'HTTPS certificate (fw.sunrisebayumas.com)', 'Could not connect to check (' + type(e).__name__ + ').', 'Try again later.', 'GitHub Pages', sort=128)

# ------------------------------------------------------------------ which GitHub secrets exist (presence only)
def secrets_check():
    names = ['ASC_KEY_P8', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'APPLE_TEAM_ID', 'IOS_DIST_P12_B64', 'IOS_DIST_P12_PASSWORD', 'IOS_PROFILE_B64', 'HEALTH_INGEST_SECRET']
    present = {n: os.environ.get('HAS_' + n) == 'true' for n in names}
    missing = [n for n, v in present.items() if not v]
    add('secrets', 'red' if missing else 'green', 'Build secrets (GitHub Actions)',
        ('Missing: ' + ', '.join(missing) + '.') if missing else f'All {len(names)} secrets are present (values are never shown).',
        'Add them in GitHub → repo Settings → Secrets and variables → Actions.' if missing else 'Nothing to do.',
        'GitHub → Settings → Secrets and variables → Actions', dict(present=present), 175)

apple_checks(); actions_check(); ssl_check(); secrets_check()

url = os.environ.get('HEALTH_URL') or 'https://gnepquxtwkyffjmoydnv.supabase.co/functions/v1/health-check'
secret = os.environ.get('HEALTH_INGEST_SECRET', '')
if not secret:
    print('HEALTH_INGEST_SECRET is not set — nothing sent.'); sys.exit(1)
try:
    code, res = http_json(url, {'Content-Type': 'application/json', 'x-health-secret': secret}, json.dumps({'items': items}).encode(), 'POST')
    print(f'Sent {len(items)} results, HTTP {code}, saved {res.get("saved") if isinstance(res, dict) else "?"}.')
except urllib.error.HTTPError as e:
    print(f'Sending failed: HTTP {e.code}.'); sys.exit(1)
