/**
 * Platform catalog — registers every supported board / agency / ATS hostname pattern.
 * Deeper ATS stubs in adapters/ats/ re-register the same id with better selectors.
 * Job boards often redirect into an ATS host at apply time; detection re-runs on the apply URL.
 */
(function (global) {
  'use strict';

  function makeThin(def) {
    var HOSTS = def.hosts || [];
    var HOST_RE = def.hostRe;
    function detect(url, doc) {
      url = String(url || '');
      try {
        var u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
        if (HOST_RE.test(u.hostname) || HOST_RE.test(url)) return true;
        for (var i = 0; i < HOSTS.length; i++) {
          var h = HOSTS[i].replace(/^www\./, '');
          if (u.hostname === HOSTS[i] || u.hostname === h || u.hostname.endsWith('.' + h)) return true;
        }
      } catch (_e) {
        if (HOST_RE.test(url)) return true;
      }
      return false;
    }
    var adapter = {
      id: def.id,
      name: def.name,
      category: def.category,
      hosts: HOSTS,
      detect: detect,
      fieldMaps: [],
      submitSelector: def.submitSelector || 'button[type="submit"], input[type="submit"]',
      fileInputHints: def.fileInputHints || [
        { kind: 'resume', match: 'resume|cv' },
        { kind: 'cover', match: 'cover' }
      ],
      fill: function (ctx) {
        var fb = global.FillApplyFallbackAdapter;
        if (!fb) {
          return { ok: false, adapterId: def.id, error: 'Fallback adapter missing', filled: 0, unmatched: 0, total: 0 };
        }
        return fb.fill(Object.assign({}, ctx, {
          adapterId: def.id,
          submitSelector: adapter.submitSelector,
          fileInputHints: adapter.fileInputHints,
          fieldMaps: adapter.fieldMaps
        }));
      }
    };
    return adapter;
  }

  var PLATFORM_DEFS = [
    { id: 'linkedin', name: 'LinkedIn', category: 'board', hosts: ['linkedin.com', 'www.linkedin.com'], hostRe: /linkedin\.com/i },
    { id: 'upwork', name: 'Upwork', category: 'board', hosts: ['upwork.com', 'www.upwork.com'], hostRe: /upwork\.com/i },
    { id: 'naukrigulf', name: 'NaukriGulf', category: 'board', hosts: ['naukrigulf.com', 'www.naukrigulf.com'], hostRe: /naukrigulf\.com/i },
    { id: 'remoteok', name: 'Remote OK', category: 'board', hosts: ['remoteok.com', 'remoteok.io'], hostRe: /remoteok\.(com|io)/i },
    { id: 'weworkremotely', name: 'We Work Remotely', category: 'board', hosts: ['weworkremotely.com'], hostRe: /weworkremotely\.com/i },
    { id: 'indeed', name: 'Indeed', category: 'board', hosts: ['indeed.com', 'www.indeed.com', 'pk.indeed.com', 'ae.indeed.com'], hostRe: /(^|\.)indeed\.com$/i },
    { id: 'efinancialcareers', name: 'eFinancialCareers', category: 'board', hosts: ['efinancialcareers.com', 'www.efinancialcareers.com'], hostRe: /efinancialcareers\.com/i },
    { id: 'freehire', name: 'FreeHire', category: 'board', hosts: ['freehire.com', 'www.freehire.com'], hostRe: /freehire\.com/i },
    { id: 'workingnomads', name: 'Working Nomads', category: 'board', hosts: ['workingnomads.com', 'www.workingnomads.com'], hostRe: /workingnomads\.com/i },
    { id: 'jooble', name: 'Jooble', category: 'board', hosts: ['jooble.org', 'www.jooble.org'], hostRe: /jooble\.org/i },
    { id: 'swooped', name: 'Swooped', category: 'board', hosts: ['swooped.co', 'www.swooped.co', 'app.swooped.co'], hostRe: /swooped\.co/i },
    { id: 'bayt', name: 'Bayt', category: 'board', hosts: ['bayt.com', 'www.bayt.com'], hostRe: /bayt\.com/i },
    { id: 'gulftalent', name: 'GulfTalent', category: 'board', hosts: ['gulftalent.com', 'www.gulftalent.com'], hostRe: /gulftalent\.com/i },
    { id: 'glassdoor', name: 'Glassdoor', category: 'board', hosts: ['glassdoor.com', 'www.glassdoor.com'], hostRe: /glassdoor\.com/i },
    { id: 'wellfound', name: 'Wellfound', category: 'board', hosts: ['wellfound.com', 'angel.co', 'talent.wellfound.com'], hostRe: /wellfound\.com|angel\.co/i },
    { id: 'angellist', name: 'AngelList / Talent', category: 'board', hosts: ['angel.co', 'wellfound.com'], hostRe: /angel\.co|wellfound\.com/i },
    { id: 'flexjobs', name: 'FlexJobs', category: 'board', hosts: ['flexjobs.com', 'www.flexjobs.com'], hostRe: /flexjobs\.com/i },
    { id: 'remoteco', name: 'Remote.co', category: 'board', hosts: ['remote.co', 'www.remote.co'], hostRe: /remote\.co/i },
    { id: 'remotive', name: 'Remotive', category: 'board', hosts: ['remotive.com', 'remotive.io'], hostRe: /remotive\.(com|io)/i },
    { id: 'himalayas', name: 'Himalayas', category: 'board', hosts: ['himalayas.app', 'www.himalayas.app'], hostRe: /himalayas\.app/i },
    { id: 'otta', name: 'Otta', category: 'board', hosts: ['otta.com', 'www.otta.com'], hostRe: /otta\.com/i },
    { id: 'jobgether', name: 'Jobgether', category: 'board', hosts: ['jobgether.com', 'www.jobgether.com'], hostRe: /jobgether\.com/i },
    { id: 'ycombinator', name: 'Y Combinator Jobs', category: 'board', hosts: ['ycombinator.com', 'www.ycombinator.com', 'workatastartup.com'], hostRe: /ycombinator\.com|workatastartup\.com/i },
    { id: 'builtin', name: 'Built In', category: 'board', hosts: ['builtin.com', 'www.builtin.com'], hostRe: /builtin\.com/i },
    { id: 'michaelpage', name: 'Michael Page', category: 'agency', hosts: ['michaelpage.com', 'www.michaelpage.com', 'michaelpage.ae'], hostRe: /michaelpage\./i },
    { id: 'hays', name: 'Hays', category: 'agency', hosts: ['hays.com', 'www.hays.com'], hostRe: /hays\.com/i },
    { id: 'roberthalf', name: 'Robert Half', category: 'agency', hosts: ['roberthalf.com', 'www.roberthalf.com'], hostRe: /roberthalf\.com/i },
    { id: 'cooperfitch', name: 'Cooper Fitch', category: 'agency', hosts: ['cooperfitch.com', 'www.cooperfitch.com'], hostRe: /cooperfitch\.com/i },
    { id: 'charterhouse', name: 'Charterhouse', category: 'agency', hosts: ['charterhouse.com', 'www.charterhouse.com', 'charterhouse.com.sg'], hostRe: /charterhouse\./i },
    { id: 'robertwalters', name: 'Robert Walters', category: 'agency', hosts: ['robertwalters.com', 'www.robertwalters.com'], hostRe: /robertwalters\.com/i },
    { id: 'jivaropartners', name: 'Jivaro Partners', category: 'agency', hosts: ['jivaropartners.com', 'www.jivaropartners.com'], hostRe: /jivaropartners\.com/i },
    { id: 'lhh', name: 'LHH', category: 'agency', hosts: ['lhh.com', 'www.lhh.com'], hostRe: /lhh\.com/i },
    { id: 'greenhouse', name: 'Greenhouse', category: 'ats', hosts: ['boards.greenhouse.io', 'greenhouse.io', 'job-boards.greenhouse.io'], hostRe: /greenhouse\.io/i },
    { id: 'ashby', name: 'Ashby', category: 'ats', hosts: ['jobs.ashbyhq.com', 'ashbyhq.com'], hostRe: /ashbyhq\.com/i },
    { id: 'lever', name: 'Lever', category: 'ats', hosts: ['jobs.lever.co', 'lever.co'], hostRe: /lever\.co/i },
    { id: 'workable', name: 'Workable', category: 'ats', hosts: ['apply.workable.com', 'jobs.workable.com', 'workable.com'], hostRe: /workable\.com/i },
    { id: 'workday', name: 'Workday', category: 'ats', hosts: ['myworkdayjobs.com', 'workdayjobs.com', 'workday.com'], hostRe: /myworkdayjobs\.com|workdayjobs\.com|workday\.com/i },
    { id: 'smartrecruiters', name: 'SmartRecruiters', category: 'ats', hosts: ['jobs.smartrecruiters.com', 'smartrecruiters.com'], hostRe: /smartrecruiters\.com/i },
    { id: 'icims', name: 'iCIMS', category: 'ats', hosts: ['icims.com', 'careers-*.icims.com'], hostRe: /icims\.com/i },
    { id: 'cats', name: 'CATS', category: 'ats', hosts: ['catsone.com', 'www.catsone.com'], hostRe: /catsone\.com/i },
    { id: 'recruitee', name: 'Recruitee', category: 'ats', hosts: ['recruitee.com', 'www.recruitee.com'], hostRe: /(^|\.)recruitee\.com$/i },
    { id: 'teamtailor', name: 'Teamtailor', category: 'ats', hosts: ['teamtailor.com', 'www.teamtailor.com', 'app.teamtailor.com'], hostRe: /(^|\.)teamtailor\.com$/i },
    { id: 'successfactors', name: 'SAP SuccessFactors', category: 'ats', hosts: ['afuturewithus.com', 'www.afuturewithus.com', 'successfactors.com', 'successfactors.eu'], hostRe: /afuturewithus\.com|successfactors\.(com|eu)/i }
  ];

  var index = [];
  PLATFORM_DEFS.forEach(function (def) {
    var adapter = makeThin(def);
    if (global.FillApplyRegistry) global.FillApplyRegistry.register(adapter);
    index.push({ id: def.id, name: def.name, category: def.category, hosts: def.hosts });
  });

  global.FillApplyPlatformIndex = index;
})(typeof globalThis !== 'undefined' ? globalThis : self);
