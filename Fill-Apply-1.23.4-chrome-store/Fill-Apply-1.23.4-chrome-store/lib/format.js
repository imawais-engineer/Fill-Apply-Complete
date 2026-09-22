/**
 * Value formatting for a specific control.
 *
 * Knowing *which* field we found is only half the job — the value still has to
 * be in the shape that field accepts, and application forms disagree wildly:
 *
 *   - Greenhouse/Lever take a single phone field and are happy with +971501234567.
 *   - Indeed, LinkedIn and iCIMS render a country-code selector next to the
 *     number, so the same value must arrive as 501234567 with the code stripped.
 *   - Workday and many US career sites enforce pattern="\d{10}" or maxlength=10
 *     and silently reject anything with a "+" or a space.
 *   - US ZIP inputs are maxlength=5 numeric; Canadian and UK postcodes need a
 *     space in the right place and uppercase letters.
 *   - type="url" rejects "linkedin.com/in/name" without a scheme, while fields
 *     asking for a "username" reject the full URL.
 *
 * So every value is shaped against the constraints the control actually
 * advertises (type, pattern, maxlength, inputmode, step, placeholder mask) and,
 * for phone numbers, against whether the form has a separate country-code field.
 *
 * Attaches globalThis.FillApplyFormat.
 */
(function (global) {
  'use strict';

  /**
   * Longest-match dial codes, needed to split "+971501234567" into a country
   * code and a national number when the form wants them apart.
   */
  var DIAL_CODES = [
    '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41',
    '43', '44', '45', '46', '47', '48', '49', '51', '52', '54', '55', '56', '57',
    '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90',
    '91', '92', '93', '94', '95', '98', '212', '213', '216', '218', '220', '233',
    '234', '249', '251', '254', '255', '256', '260', '263', '264', '265', '267',
    '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371',
    '372', '373', '374', '375', '376', '377', '380', '381', '385', '386', '387',
    '389', '420', '421', '423', '501', '502', '503', '504', '505', '506', '507',
    '509', '590', '591', '593', '594', '595', '598', '852', '853', '855', '856',
    '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968',
    '970', '971', '972', '973', '974', '975', '976', '977', '992', '993', '994',
    '995', '996', '998'
  ];

  /**
   * Country aliases so a select offering "AE" still matches "United Arab
   * Emirates". `demonym` is here because nationality and citizenship selects
   * list the people, not the country: "Pakistani", not "Pakistan".
   */
  var COUNTRIES = [
    { name: 'United Arab Emirates', iso2: 'AE', iso3: 'ARE', dial: '971', demonym: 'Emirati', aka: ['uae', 'u.a.e.', 'emirates'] },
    { name: 'Saudi Arabia', iso2: 'SA', iso3: 'SAU', dial: '966', demonym: 'Saudi', aka: ['ksa', 'kingdom of saudi arabia', 'saudi arabian'] },
    { name: 'Qatar', iso2: 'QA', iso3: 'QAT', dial: '974', demonym: 'Qatari', aka: [] },
    { name: 'Kuwait', iso2: 'KW', iso3: 'KWT', dial: '965', demonym: 'Kuwaiti', aka: [] },
    { name: 'Bahrain', iso2: 'BH', iso3: 'BHR', dial: '973', demonym: 'Bahraini', aka: [] },
    { name: 'Oman', iso2: 'OM', iso3: 'OMN', dial: '968', demonym: 'Omani', aka: [] },
    { name: 'Egypt', iso2: 'EG', iso3: 'EGY', dial: '20', demonym: 'Egyptian', aka: [] },
    { name: 'Jordan', iso2: 'JO', iso3: 'JOR', dial: '962', demonym: 'Jordanian', aka: [] },
    { name: 'Lebanon', iso2: 'LB', iso3: 'LBN', dial: '961', demonym: 'Lebanese', aka: [] },
    { name: 'Pakistan', iso2: 'PK', iso3: 'PAK', dial: '92', demonym: 'Pakistani', aka: [] },
    { name: 'India', iso2: 'IN', iso3: 'IND', dial: '91', demonym: 'Indian', aka: [] },
    { name: 'Bangladesh', iso2: 'BD', iso3: 'BGD', dial: '880', demonym: 'Bangladeshi', aka: [] },
    { name: 'Sri Lanka', iso2: 'LK', iso3: 'LKA', dial: '94', demonym: 'Sri Lankan', aka: [] },
    { name: 'Philippines', iso2: 'PH', iso3: 'PHL', dial: '63', demonym: 'Filipino', aka: [] },
    { name: 'United States', iso2: 'US', iso3: 'USA', dial: '1', demonym: 'American', aka: ['usa', 'u.s.', 'u.s.a.', 'united states of america', 'america'] },
    { name: 'Canada', iso2: 'CA', iso3: 'CAN', dial: '1', demonym: 'Canadian', aka: [] },
    { name: 'United Kingdom', iso2: 'GB', iso3: 'GBR', dial: '44', demonym: 'British', aka: ['uk', 'u.k.', 'great britain', 'england', 'britain'] },
    { name: 'Ireland', iso2: 'IE', iso3: 'IRL', dial: '353', demonym: 'Irish', aka: [] },
    { name: 'Germany', iso2: 'DE', iso3: 'DEU', dial: '49', demonym: 'German', aka: ['deutschland'] },
    { name: 'France', iso2: 'FR', iso3: 'FRA', dial: '33', demonym: 'French', aka: [] },
    { name: 'Netherlands', iso2: 'NL', iso3: 'NLD', dial: '31', demonym: 'Dutch', aka: ['holland', 'the netherlands'] },
    { name: 'Spain', iso2: 'ES', iso3: 'ESP', dial: '34', demonym: 'Spanish', aka: [] },
    { name: 'Portugal', iso2: 'PT', iso3: 'PRT', dial: '351', demonym: 'Portuguese', aka: [] },
    { name: 'Italy', iso2: 'IT', iso3: 'ITA', dial: '39', demonym: 'Italian', aka: [] },
    { name: 'Poland', iso2: 'PL', iso3: 'POL', dial: '48', demonym: 'Polish', aka: [] },
    { name: 'Sweden', iso2: 'SE', iso3: 'SWE', dial: '46', demonym: 'Swedish', aka: [] },
    { name: 'Switzerland', iso2: 'CH', iso3: 'CHE', dial: '41', demonym: 'Swiss', aka: [] },
    { name: 'Australia', iso2: 'AU', iso3: 'AUS', dial: '61', demonym: 'Australian', aka: [] },
    { name: 'New Zealand', iso2: 'NZ', iso3: 'NZL', dial: '64', demonym: 'New Zealander', aka: [] },
    { name: 'Singapore', iso2: 'SG', iso3: 'SGP', dial: '65', demonym: 'Singaporean', aka: [] },
    { name: 'Hong Kong', iso2: 'HK', iso3: 'HKG', dial: '852', demonym: 'Hong Konger', aka: [] },
    { name: 'Malaysia', iso2: 'MY', iso3: 'MYS', dial: '60', demonym: 'Malaysian', aka: [] },
    { name: 'Indonesia', iso2: 'ID', iso3: 'IDN', dial: '62', demonym: 'Indonesian', aka: [] },
    { name: 'Japan', iso2: 'JP', iso3: 'JPN', dial: '81', demonym: 'Japanese', aka: [] },
    { name: 'China', iso2: 'CN', iso3: 'CHN', dial: '86', demonym: 'Chinese', aka: [] },
    { name: 'South Africa', iso2: 'ZA', iso3: 'ZAF', dial: '27', demonym: 'South African', aka: [] },
    { name: 'Nigeria', iso2: 'NG', iso3: 'NGA', dial: '234', demonym: 'Nigerian', aka: [] },
    { name: 'Kenya', iso2: 'KE', iso3: 'KEN', dial: '254', demonym: 'Kenyan', aka: [] },
    { name: 'Turkey', iso2: 'TR', iso3: 'TUR', dial: '90', demonym: 'Turkish', aka: ['turkiye', 'türkiye'] },
    { name: 'Brazil', iso2: 'BR', iso3: 'BRA', dial: '55', demonym: 'Brazilian', aka: [] },
    { name: 'Mexico', iso2: 'MX', iso3: 'MEX', dial: '52', demonym: 'Mexican', aka: [] }
  ];

  /**
   * Education levels ranked, so "Master's / MBA" can find whichever wording a
   * given form uses — and, when the form does not offer that level at all, can
   * fall back to the highest level below it rather than to nothing.
   */
  var EDUCATION_LEVELS = [
    {
      rank: 60,
      name: "Doctorate",
      match: /\b(doctorate|doctoral|ph\.?\s?d|d\.?phil|md\b|dba\b)\b/,
      spellings: ["Doctorate", "Doctorate (PhD)", "PhD", "Doctoral Degree"]
    },
    {
      rank: 50,
      name: "Master's Degree",
      match: /\b(master'?s?|mba|e.?mba|emba|executive\s*mba|m\.?b\.?a|m\.?sc|m\.?s\b|m\.?a\b|m\.?com|post.?graduate|postgraduate|graduate degree)\b/,
      spellings: [
        "Master's Degree", "Masters Degree", "Master's", "Masters", "Master",
        "MBA", "EMBA", "Executive MBA", "MBA Executive", "Postgraduate", "Post Graduate", "Graduate Degree",
        "Master's degree or equivalent"
      ]
    },
    {
      rank: 40,
      name: "Bachelor's Degree",
      match: /\b(bachelor'?s?|under.?graduate|b\.?sc|b\.?s\b|b\.?a\b|b\.?com|bcom|bachelor of commerce|b\.?e\b|b\.?tech|licence|licenciatura)\b/,
      spellings: [
        "Bachelor's Degree", "Bachelors Degree", "Bachelor's", "Bachelors",
        "Bachelor", "Undergraduate", "University Degree", "Degree",
        "B.Com", "BCom", "Bachelor of Commerce", "B.Com.",
        "Bachelor's degree or equivalent"
      ]
    },
    {
      rank: 30,
      name: 'Associate / Diploma',
      match: /\b(associate|diploma|vocational|technical certificate|higher national)\b/,
      spellings: ["Associate Degree", "Associate's Degree", 'Diploma', 'Vocational', 'Technical Diploma']
    },
    {
      rank: 20,
      name: 'High School',
      match: /\b(high school|secondary|ged\b|matric|o.?level|a.?level|12th|intermediate)\b/,
      spellings: ['High School', 'High School Diploma', 'Secondary School', 'GED', 'Secondary Education']
    },
    {
      rank: 10,
      name: 'No formal education',
      match: /\b(none|no formal|less than high school|primary)\b/,
      spellings: ['None', 'No formal education', 'Less than High School']
    }
  ];

  /**
   * Availability wordings for "can start now", widest first. "Within N days"
   * is included because immediate availability genuinely satisfies it; a bare
   * "15 days" is not, since that reads as a notice the applicant must serve.
   */
  var IMMEDIATE_NOTICE = [
    'Immediately',
    'Immediate',
    'Available immediately',
    'I can start immediately',
    'Onspot',
    'On spot',
    'Now',
    'Less than 15 days',
    'Within 15 days',
    '15 days or less',
    'Less than 1 month'
  ];

  var US_STATES = [
    ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'],
    ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'], ['Delaware', 'DE'],
    ['District of Columbia', 'DC'], ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'],
    ['Idaho', 'ID'], ['Illinois', 'IL'], ['Indiana', 'IN'], ['Iowa', 'IA'],
    ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'],
    ['Maryland', 'MD'], ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'],
    ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'], ['Nebraska', 'NE'],
    ['Nevada', 'NV'], ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'],
    ['New York', 'NY'], ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'],
    ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'], ['Rhode Island', 'RI'],
    ['South Carolina', 'SC'], ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'],
    ['Utah', 'UT'], ['Vermont', 'VT'], ['Virginia', 'VA'], ['Washington', 'WA'],
    ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY']
  ];

  var CURRENCY_RE =
    /\b(AED|SAR|USD|EUR|GBP|PKR|INR|CAD|AUD|CHF|JPY|CNY|QAR|KWD|BHD|OMR|EGP|ZAR|SGD|HKD|MYR|TRY|BRL|MXN)\b/gi;

  function str(value) {
    return value == null ? '' : String(value);
  }

  function trim(value) {
    return str(value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return trim(value).toLowerCase();
  }

  function digitsOf(value) {
    return str(value).replace(/\D+/g, '');
  }

  function isBlank(value) {
    return value == null || String(value).trim() === '';
  }

  /** Numeric attribute or null — jsdom and Chrome both report maxLength as -1 when unset. */
  function positiveNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Numeric attribute or null. An absent min/max reads back as "", and Number("")
   * is 0, which would clamp every salary to zero.
   */
  function numberAttr(value) {
    if (value == null || String(value).trim() === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function attr(el, name) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute(name) || '';
  }

  /**
   * Normalize an element or an existing descriptor into the constraint bag the
   * formatters read, so callers can pass either.
   */
  function constraintsOf(target) {
    if (!target) return {};
    var isElement = !!(target.tagName || target.nodeType === 1);
    if (!isElement) {
      return {
        type: lower(target.type),
        name: str(target.name),
        id: str(target.id),
        autocomplete: lower(target.autocomplete),
        placeholder: str(target.placeholder),
        label: str(target.label),
        pattern: str(target.pattern),
        inputMode: lower(target.inputMode || target.inputmode),
        maxLength: positiveNumber(target.maxLength),
        min: target.min,
        max: target.max,
        step: target.step,
        title: str(target.title),
        tag: str(target.tag || target.tagName)
      };
    }
    return {
      type: lower(target.type),
      name: attr(target, 'name'),
      id: str(target.id),
      autocomplete: lower(attr(target, 'autocomplete')),
      placeholder: attr(target, 'placeholder'),
      label: '',
      pattern: attr(target, 'pattern'),
      inputMode: lower(attr(target, 'inputmode')),
      maxLength: positiveNumber(target.maxLength),
      min: attr(target, 'min'),
      max: attr(target, 'max'),
      step: attr(target, 'step'),
      title: attr(target, 'title'),
      tag: str(target.tagName)
    };
  }

  function blobOf(c) {
    return lower([c.autocomplete, c.name, c.id, c.label, c.placeholder, c.title].join(' '));
  }

  /**
   * What kind of value this control wants. `key` is the profile key the answer
   * came from and is trusted first, since the field map already did the
   * label/name/autocomplete matching.
   */
  
  function optionsLookLikeDialCodes(target) {
    var list = [];
    if (!target) return false;
    if (Array.isArray(target.options)) list = target.options;
    else if (target.options && target.options.length != null) {
      for (var i = 0; i < target.options.length; i++) {
        list.push({ text: target.options[i].text || target.options[i].textContent, value: target.options[i].value });
      }
    } else if (target.tag === 'SELECT' || (target.tagName && String(target.tagName).toUpperCase() === 'SELECT')) {
      // constraintsOf may not carry options; caller should pass descriptor.options
      return false;
    }
    if (!list.length) return false;
    var dialish = 0;
    var n = Math.min(list.length, 40);
    for (var j = 0; j < n; j++) {
      var o = list[j];
      var t = String((o && (o.text || o.label || o.value)) || '');
      if (/\+\d{1,4}\b/.test(t) || /^\s*\d{1,4}\s*[-–/]/.test(t)) dialish += 1;
    }
    return dialish >= 3 || (dialish >= 1 && dialish / n >= 0.25);
  }

function fieldKind(target, key) {
    var c = constraintsOf(target);
    var blob = blobOf(c);
    var type = c.type;
    // Knowledge keys are snake_case; profile/field-map keys are camelCase
    var keyNorm = String(key || '')
      .replace(/([A-Z])/g, function (ch) { return '_' + ch.toLowerCase(); })
      .replace(/^_/, '')
      .toLowerCase();
    var keyCamel = String(key || '').replace(/_([a-z])/g, function (_, ch) {
      return ch.toUpperCase();
    });

    if (key === 'phoneCountry' || keyNorm === 'phone_country') return 'phoneCountry';
    if (c.autocomplete === 'tel-country-code') return 'phoneCountry';
    if (/\b(country code|dial code|calling code|phone country|area code)\b/.test(blob)) {
      return 'phoneCountry';
    }
    // Bare "Country*" next to a phone, or a select whose options are dial codes.
    if (optionsLookLikeDialCodes(target) || optionsLookLikeDialCodes(c)) {
      return 'phoneCountry';
    }
    if (/^\s*country\b/.test(blob) && /\+\d{1,4}/.test(blob)) {
      return 'phoneCountry';
    }

    if (key === 'phone' || type === 'tel' || c.autocomplete === 'tel') return 'phone';
    if (/\b(phone|mobile|telephone|cell|whatsapp)\b/.test(blob)) return 'phone';

    if (key === 'zip' || key === 'postcode') return 'postal';
    if (c.autocomplete === 'postal-code') return 'postal';
    if (/\b(zip|postal|postcode|post code|pin code)\b/.test(blob)) return 'postal';

    if (key === 'email' || type === 'email') return 'email';

    if (type === 'url') return 'url';
    if (['linkedin', 'portfolio', 'website', 'github', 'resumeUrl', 'coverUrl'].indexOf(key) !== -1) {
      return 'url';
    }

    if (
      key === 'dateOfBirth' ||
      keyNorm === 'date_of_birth' ||
      key === 'birthYear' ||
      key === 'birthMonth' ||
      key === 'birthDay' ||
      keyNorm === 'birth_year' ||
      keyNorm === 'birth_month' ||
      keyNorm === 'birth_day'
    ) {
      return 'date';
    }
    if (type === 'date' || type === 'month' || type === 'week') return 'date';
    if (
      /\b(date of birth|birth date|\bdob\b|birth\s*year|birth\s*month|birth\s*day|start date|available from|graduation date)\b/.test(
        blob
      )
    ) {
      return 'date';
    }

    if (key === 'nationality' || key === 'citizenship') return 'nationality';
    if (/\b(nationality|citizenship|citizen of|country of nationality)\b/.test(blob)) return 'nationality';
    if (key === 'countryOfResidence' || key === 'residenceCountry' || key === 'residence') return 'residence';
    if (/\b(country of residence|country\/region of residence|what country do you live|reside in|residential country)\b/.test(blob)) {
      return 'residence';
    }
    if (key === 'country') return 'country';
    if (/\b(country|country\/region)\b/.test(blob) && !/code|dial|phone|mobile|nationality|citizen/.test(blob)) {
      return 'country';
    }
    if (key === 'state') return 'state';
    if (['fullName', 'firstName', 'lastName', 'middleName', 'preferredName'].indexOf(key) !== -1) {
      return 'name';
    }
    if (key === 'salutation' || key === 'title' || keyNorm === 'salutation' || keyNorm === 'title') {
      // Honorific Title (Mr/Ms) — not job title
      if (!/\b(job|current|position|role|designation)\b/.test(blob)) return 'salutation';
    }

    // Screening kinds. These are checked before the plain numeric kinds so a
    // "Years of experience" select can be matched against its buckets, and a
    // "Years of experience" number input still lands on formatNumber below.
    if (
      key === 'highestEducation' ||
      keyCamel === 'highestEducation' ||
      keyNorm === 'highest_education' ||
      keyNorm === 'highest_level_education'
    ) {
      return 'educationLevel';
    }
    if (/\b(highest (level of )?education|education level|level of education|highest degree|highest qualification|qualification level)\b/.test(blob)) {
      return 'educationLevel';
    }
    if (key === 'yearsExperience') return 'yearsExperience';
    if (/\b(years? of experience|years experience|experience in years|total experience|how many years)\b/.test(blob)) {
      return 'yearsExperience';
    }
    if (key === 'noticePeriod') return 'noticePeriod';
    if (/\b(notice period|when can you start|earliest start|availability to start|how soon can you)\b/.test(blob)) {
      return 'noticePeriod';
    }
    if (['currentSalary', 'expectedSalary'].indexOf(key) !== -1) return 'salary';
    if (/\b(salary|compensation|pay rate|remuneration|\bote\b|ctc\b)\b/.test(blob)) return 'salary';
    if (key === 'gender') return 'gender';

    if (type === 'number' || type === 'range') return 'number';
    if (c.inputMode === 'numeric' || c.inputMode === 'decimal') return 'number';
    if (type === 'tel' && /\d/.test(c.pattern)) return 'number';

    return 'text';
  }

  /** Anchored test, because pattern="\d{10}" means the whole value. */
  function matchesPattern(value, pattern) {
    if (!pattern) return true;
    try {
      return new RegExp('^(?:' + pattern + ')$').test(str(value));
    } catch (_e) {
      return true;
    }
  }

  function fitsLength(value, maxLength) {
    return !maxLength || str(value).length <= maxLength;
  }

  /**
   * Digit slots in a placeholder mask: "(555) 555-5555", "___-___-____",
   * "xxx-xxx-xxxx", "+1 999 999 9999". Anything else is a literal.
   */
  function maskSlots(mask) {
    var m = str(mask);
    var count = 0;
    for (var i = 0; i < m.length; i++) {
      if (/[0-9_xX#]/.test(m[i])) count += 1;
    }
    return count;
  }

  function looksLikeMask(mask) {
    var m = str(mask);
    if (!m) return false;
    if (maskSlots(m) < 6) return false;
    // A real example number is a mask too, but prose like "Enter your phone" is not.
    return !/[a-wyzA-WYZ]{3,}/.test(m.replace(/[xX]/g, ''));
  }

  function applyMask(digits, mask) {
    var d = digitsOf(digits);
    var out = '';
    var di = 0;
    for (var i = 0; i < mask.length; i++) {
      var ch = mask[i];
      if (/[0-9_xX#]/.test(ch)) {
        if (di >= d.length) return '';
        out += d[di++];
      } else {
        out += ch;
      }
    }
    return di === d.length ? out : '';
  }

  function findCountry(value) {
    var v = lower(value).replace(/[.]/g, '');
    if (!v) return null;
    for (var i = 0; i < COUNTRIES.length; i++) {
      var c = COUNTRIES[i];
      if (lower(c.name) === v || lower(c.iso2) === v || lower(c.iso3) === v) return c;
      if (c.demonym && lower(c.demonym) === v) return c;
      for (var a = 0; a < c.aka.length; a++) {
        if (lower(c.aka[a]).replace(/[.]/g, '') === v) return c;
      }
    }
    return null;
  }

  function countryByDial(dial) {
    var d = digitsOf(dial);
    if (!d) return null;
    for (var i = 0; i < COUNTRIES.length; i++) {
      if (COUNTRIES[i].dial === d) return COUNTRIES[i];
    }
    return null;
  }

  /** Longest dial code that prefixes these digits. */
  function splitDial(digits) {
    var d = digitsOf(digits);
    var best = '';
    for (var i = 0; i < DIAL_CODES.length; i++) {
      var code = DIAL_CODES[i];
      if (d.indexOf(code) === 0 && code.length > best.length) best = code;
    }
    return best ? { dial: best, national: d.slice(best.length) } : { dial: '', national: d };
  }

  /**
   * Split a profile into the phone pieces every layout needs: the dial code on
   * its own, the national number without a trunk zero, and full E.164.
   */
  function phoneParts(profile) {
    profile = profile || {};
    // Prefer explicit full E.164 when present (phoneFull / phoneE164 / phone_full).
    var rawFull = trim(profile.phoneFull || profile.phoneE164 || profile.phone_full || profile.phone_e164);
    var rawPhone = trim(profile.phone) || rawFull;
    var rawCountry = trim(profile.phoneCountry || profile.phoneCountryCode || profile.phone_country);
    var dial = digitsOf(rawCountry);
    // "UAE (+971)" and "+971" both appear in stored profiles.
    if (!dial && rawCountry) dial = digitsOf((rawCountry.match(/\+?\d[\d\s-]*/) || [''])[0]);

    var national = digitsOf(rawPhone);
    var explicitPlus = /^\s*\+/.test(rawPhone);

    if (explicitPlus) {
      var split = splitDial(national);
      if (split.dial) {
        if (!dial) dial = split.dial;
        national = split.national;
      }
    } else if (dial && national.indexOf(dial) === 0 && national.length > dial.length + 5) {
      // Stored as "971501234567" alongside phoneCountry "+971".
      national = national.slice(dial.length);
    }

    // Trunk prefix is national-only notation; it must not survive next to a code.
    if (dial && national.length > 1 && national[0] === '0') national = national.replace(/^0+/, '');

    // If we still lack a dial code but phoneFull/E.164 was provided, re-parse it.
    if ((!dial || !national) && rawFull) {
      var fullDigits = digitsOf(rawFull);
      if (/^\s*\+/.test(rawFull) && fullDigits) {
        var splitFull = splitDial(fullDigits);
        if (splitFull.dial) {
          if (!dial) dial = splitFull.dial;
          if (!national) national = splitFull.national;
        }
      }
    }

    return {
      dial: dial ? '+' + dial : '',
      dialDigits: dial,
      national: national,
      trunk: national ? '0' + national : '',
      // Without a known country code there is no E.164 form to offer; inventing
      // a "+" in front of a national number produces an invalid number.
      e164: dial && national ? '+' + dial + national : '',
      digits: dial && national ? dial + national : national,
      country: countryByDial(dial)
    };
  }

  /** Exact digit count when a pattern is nothing but N digits, e.g. "\d{10}". */
  function patternDigitCount(pattern) {
    var p = str(pattern).trim();
    if (!p) return null;
    var m = p.match(/^(?:\\d|\[0-9\])\{(\d+)\}$/);
    return m ? Number(m[1]) : null;
  }

  /**
   * Pick the phone shape this control accepts.
   *
   * `hasCountryField` matters most: when the form renders its own country-code
   * selector, sending E.164 into the number box produces "+971+971501234567".
   */
  function formatPhone(target, parts, opts) {
    opts = opts || {};
    var c = constraintsOf(target);
    var hasCountryField = !!opts.hasCountryField;
    if (!parts || (!parts.national && !parts.digits)) return { value: '', skip: true };

    var national = parts.national || parts.digits;
    var candidates = [];

    function push(value, format) {
      if (value) candidates.push({ value: value, format: format });
    }

    // Strongest signal first: a pattern that spells out an exact digit count.
    var wantDigits = patternDigitCount(c.pattern);
    if (wantDigits) {
      var pool = digitsOf(parts.digits);
      if (digitsOf(national).length === wantDigits) push(national, 'pattern_national');
      else if (pool.length >= wantDigits) push(pool.slice(-wantDigits), 'pattern_digits');
    }

    // Then a placeholder that is really an input mask, e.g. "(555) 555-5555".
    if (looksLikeMask(c.placeholder)) {
      var slots = maskSlots(c.placeholder);
      var withCode = digitsOf(parts.digits);
      if (slots === withCode.length) push(applyMask(withCode, c.placeholder), 'mask');
      else if (slots === national.length) push(applyMask(national, c.placeholder), 'mask');
    }

    // Then maxlength, the bluntest signal there is: 10 means "10 digits, no plus".
    if (c.maxLength) {
      if (national.length <= c.maxLength) push(national, 'national_maxlength');
      var trimmed = digitsOf(parts.digits);
      push(trimmed.length > c.maxLength ? trimmed.slice(-c.maxLength) : trimmed, 'digits_maxlength');
    }

    if (hasCountryField) {
      push(national, 'national');
      push(parts.trunk, 'national_trunk');
      push(parts.e164, 'e164');
    } else {
      push(parts.e164, 'e164');
      push(parts.digits, 'digits_with_code');
      push(national, 'national');
      push(parts.trunk, 'national_trunk');
    }

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (matchesPattern(cand.value, c.pattern) && fitsLength(cand.value, c.maxLength)) {
        return { value: cand.value, skip: false, format: cand.format };
      }
    }

    // Nothing satisfied the constraints — digits are the safest remaining guess.
    var fallback = digitsOf(parts.digits || national);
    if (c.maxLength && fallback.length > c.maxLength) fallback = fallback.slice(-c.maxLength);
    return { value: fallback, skip: !fallback, format: 'digits' };
  }

  /** Country code on its own: "+971", "971", or the country name for a select. */
  function formatPhoneCountry(target, parts) {
    var c = constraintsOf(target);
    if (!parts || !parts.dialDigits) return { value: '', skip: true };

    if (c.tag === 'SELECT' || c.type === 'select' || c.type === 'select-one') {
      return { value: parts.dial, skip: false, format: 'dial_plus' };
    }
    var withPlus = parts.dial;
    var bare = parts.dialDigits;
    var ordered = [withPlus, bare];
    if (c.type === 'number' || c.inputMode === 'numeric' || /^\\d/.test(c.pattern)) {
      ordered = [bare, withPlus];
    }
    for (var i = 0; i < ordered.length; i++) {
      if (matchesPattern(ordered[i], c.pattern) && fitsLength(ordered[i], c.maxLength)) {
        return { value: ordered[i], skip: false, format: i === 0 ? 'preferred' : 'alternate' };
      }
    }
    return { value: bare, skip: !bare, format: 'digits' };
  }

  /**
   * Postal codes: US wants 5 digits, Canada "A1A 1A1", UK "SW1A 1AA", and
   * plenty of forms accept only what their pattern says.
   */
  function formatPostal(target, value, opts) {
    opts = opts || {};
    var c = constraintsOf(target);
    var raw = trim(value).toUpperCase();
    if (!raw) return { value: '', skip: true };

    var country = findCountry(opts.country);
    var iso = country ? country.iso2 : '';
    var candidates = [];

    function push(v, format) {
      if (v) candidates.push({ value: v, format: format });
    }

    var compact = raw.replace(/[\s-]+/g, '');
    var digits = digitsOf(raw);

    if (iso === 'CA' || /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
      push(compact.replace(/^(.{3})(.{3})$/, '$1 $2'), 'canada');
      push(compact, 'compact');
    } else if (iso === 'GB' || /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) {
      push(compact.replace(/^(.+)(\d[A-Z]{2})$/, '$1 $2'), 'uk');
      push(compact, 'compact');
    } else if (iso === 'US') {
      push(digits.slice(0, 5), 'us5');
      if (digits.length >= 9) push(digits.slice(0, 5) + '-' + digits.slice(5, 9), 'us9');
    }

    var numericOnly =
      c.type === 'number' ||
      c.inputMode === 'numeric' ||
      /^\\d|\[0-9\]/.test(c.pattern) ||
      (c.maxLength === 5 && digits.length >= 5);
    if (numericOnly && digits) push(c.maxLength ? digits.slice(0, c.maxLength) : digits, 'digits');

    push(raw, 'as_is');
    push(compact, 'compact');
    if (digits) push(digits, 'digits');

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (matchesPattern(cand.value, c.pattern) && fitsLength(cand.value, c.maxLength)) {
        return { value: cand.value, skip: false, format: cand.format };
      }
    }
    var fallback = c.maxLength ? raw.slice(0, c.maxLength) : raw;
    return { value: fallback, skip: !fallback, format: 'truncated' };
  }

  /** Ask for a username and a full URL is rejected; ask for a URL and a bare domain is. */
  function formatUrl(target, value) {
    var c = constraintsOf(target);
    var raw = trim(value).replace(/\s+/g, '');
    if (!raw) return { value: '', skip: true };

    var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw.replace(/^\/+/, '');
    var blob = blobOf(c);
    var wantsHandle =
      /\b(username|user name|handle|profile id|screen name)\b/.test(blob) ||
      (!!c.pattern && !matchesPattern(withScheme, c.pattern) && !/[:\/]/.test(c.pattern));

    if (wantsHandle) {
      var handle = withScheme
        .replace(/^[a-z]+:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '');
      var seg = handle.split('/').filter(Boolean).pop() || handle;
      if (matchesPattern(seg, c.pattern) && fitsLength(seg, c.maxLength)) {
        return { value: seg, skip: false, format: 'handle' };
      }
    }

    var ordered = [withScheme, raw.replace(/^[a-z]+:\/\//i, '')];
    for (var i = 0; i < ordered.length; i++) {
      if (matchesPattern(ordered[i], c.pattern) && fitsLength(ordered[i], c.maxLength)) {
        return { value: ordered[i], skip: false, format: i === 0 ? 'absolute' : 'bare' };
      }
    }
    return { value: withScheme, skip: false, format: 'absolute' };
  }

  function formatEmail(target, value) {
    var c = constraintsOf(target);
    var raw = str(value).replace(/\s+/g, '').trim();
    if (!raw) return { value: '', skip: true };
    if (!fitsLength(raw, c.maxLength)) return { value: raw, skip: false, format: 'over_length' };
    return { value: raw, skip: false, format: 'email' };
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function parseDateParts(value) {
    var s = trim(value);
    if (!s) return null;
    var iso = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (iso) {
      return { y: Number(iso[1]), m: Number(iso[2]), d: iso[3] ? Number(iso[3]) : 1 };
    }
    // Ambiguous dd/mm vs mm/dd: treat >12 as the day, else assume the US order
    // the majority of ATS placeholders use.
    var slash = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (slash) {
      var a = Number(slash[1]);
      var b = Number(slash[2]);
      var y = Number(slash[3]);
      if (y < 100) y += y < 50 ? 2000 : 1900;
      return a > 12 ? { y: y, m: b, d: a } : { y: y, m: a, d: b };
    }
    var parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return null;
    var dt = new Date(parsed);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  }

  /**
   * Scan hint text (placeholder / label / aria / data-format) for an explicit
   * date order. Returns iso|ymd|dmy|mdy|my|year|month|day|null.
   */
  function dateOrderFrom(hint) {
    var p = lower(hint);
    if (!p) return null;
    if (/\b(yyyy[\s./-]*mm[\s./-]*dd|yyyy-mm-dd|iso)\b/.test(p)) return 'ymd';
    if (/\b(dd[\s./-]*mm[\s./-]*yyyy|dd\/mm\/yyyy)\b/.test(p)) return 'dmy';
    if (/\b(mm[\s./-]*dd[\s./-]*yyyy|mm\/dd\/yyyy)\b/.test(p)) return 'mdy';
    if (/y{4}.*m{1,2}.*d{1,2}/.test(p)) return 'ymd';
    if (/d{1,2}.*m{1,2}.*y{2,4}/.test(p)) return 'dmy';
    if (/m{1,2}.*d{1,2}.*y{2,4}/.test(p)) return 'mdy';
    if (/m{1,2}.*y{2,4}/.test(p)) return 'my';
    if (
      /\b(birth\s*year|dob\s*year|year of birth)\b/.test(p) &&
      !/\b(month|day|mm\/|dd\/)\b/.test(p)
    ) {
      return 'year';
    }
    if (
      /\b(birth\s*month|dob\s*month|month of birth)\b/.test(p) &&
      !/\b(year|day|yyyy|dd\/)\b/.test(p)
    ) {
      return 'month';
    }
    if (
      (/\b(birth\s+day|dob\s+day|day of birth)\b/.test(p) || /\bbirth[_-]day\b/.test(p)) &&
      !/\b(year|month|yyyy|mm\/|birthday)\b/.test(p)
    ) {
      return 'day';
    }
    return null;
  }

  /**
   * Detect the date string shape a control wants.
   * Signals (strongest first): input type, data-format / data-date-format,
   * pattern, placeholder, aria / label / name / id, autocomplete=bday.
   */
  function detectDateFormat(target, context) {
    context = context || {};
    var c = constraintsOf(target);
    if (context.label) c.label = str(context.label);
    var dataFormat = '';
    var aria = '';
    if (target && target.getAttribute) {
      dataFormat = [
        attr(target, 'data-format'),
        attr(target, 'data-date-format'),
        attr(target, 'data-datepicker-format'),
        attr(target, 'data-dateformat')
      ]
        .filter(Boolean)
        .join(' ');
      aria = [
        attr(target, 'aria-label'),
        attr(target, 'aria-description'),
        attr(target, 'aria-placeholder')
      ]
        .filter(Boolean)
        .join(' ');
      if (!c.label) c.label = aria;
    } else if (target && typeof target === 'object') {
      dataFormat = str(
        target.dataFormat || target['data-format'] || target.dateFormat || ''
      );
      aria = str(target.ariaLabel || target['aria-label'] || '');
      if (!c.label) c.label = str(target.label || aria);
    }

    if (c.type === 'date') return 'iso';
    if (c.type === 'month') return 'iso_month';

    var blob = [
      dataFormat,
      c.placeholder,
      c.pattern,
      c.autocomplete,
      c.name,
      c.id,
      c.label,
      aria,
      context.label
    ]
      .map(str)
      .join(' ');

    var nameId = lower(c.name + ' ' + c.id + ' ' + c.autocomplete);
    if (/\b(birth[_-]?year|dob[_-]?year|yearofbirth|bday-year|bday_year)\b/.test(nameId) && !/\bbirthday\b/.test(nameId)) {
      return 'year';
    }
    if (/\b(birth[_-]?month|dob[_-]?month|monthofbirth|bday-month|bday_month)\b/.test(nameId)) {
      return 'month';
    }
    if (/\b(birth[_-]day|dob[_-]?day|dayofbirth|bday-day|bday_day)\b/.test(nameId)) {
      return 'day';
    }

    var fromData = dateOrderFrom(dataFormat);
    if (fromData) return fromData;

    var pat = str(c.pattern);
    if (
      /\\d\{4\}[^\\]*\\d\{2\}[^\\]*\\d\{2\}/.test(pat) ||
      /\^?\d{4}-\d{2}-\d{2}\$?/.test(pat)
    ) {
      return 'ymd';
    }

    var fromPlaceholder = dateOrderFrom(c.placeholder);
    if (fromPlaceholder) return fromPlaceholder;

    var fromBlob = dateOrderFrom(blob);
    if (fromBlob) return fromBlob;

    if (c.autocomplete === 'bday-day') return 'day';
    if (c.autocomplete === 'bday-month') return 'month';
    if (c.autocomplete === 'bday-year') return 'year';
    // Plain text bday with no other hint — US MM/DD (Workable default).
    if (c.autocomplete === 'bday') return 'mdy';

    return 'ambiguous';
  }

  /** Build a date string for a detected format from {y,m,d} parts. */
  function buildDateString(parts, format, sep) {
    sep = sep || '/';
    if (!parts) return '';
    if (format === 'iso' || format === 'ymd') {
      return parts.y + '-' + pad2(parts.m) + '-' + pad2(parts.d);
    }
    if (format === 'iso_month') return parts.y + '-' + pad2(parts.m);
    if (format === 'year') return String(parts.y);
    if (format === 'month') return pad2(parts.m);
    if (format === 'day') return pad2(parts.d);
    if (format === 'dmy') return [pad2(parts.d), pad2(parts.m), parts.y].join(sep);
    if (format === 'my') return [pad2(parts.m), parts.y].join(sep);
    return [pad2(parts.m), pad2(parts.d), parts.y].join(sep);
  }

  /**
   * Optional knowledge `formats` map → detected format. Formatter still works
   * from canonical ISO alone when the map is absent.
   */
  function formatsMapValue(formats, format) {
    if (!formats || typeof formats !== 'object') return '';
    var aliases = {
      iso: ['iso', 'yyyy-mm-dd', 'ymd', 'ISO'],
      ymd: ['ymd', 'yyyy-mm-dd', 'iso', 'ISO'],
      mdy: ['mdy', 'mm_dd_yyyy', 'mm/dd/yyyy', 'MM/DD/YYYY'],
      dmy: ['dmy', 'dd_mm_yyyy', 'dd/mm/yyyy', 'DD/MM/YYYY'],
      year: ['year', 'yyyy', 'YYYY'],
      month: ['month', 'mm', 'MM'],
      day: ['day', 'dd', 'DD'],
      iso_month: ['iso_month', 'yyyy-mm']
    };
    var keys = aliases[format] || [format];
    for (var i = 0; i < keys.length; i++) {
      var v = formats[keys[i]];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function formatDate(target, value, context) {
    context = context || {};
    var c = constraintsOf(target);
    if (context.label) c.label = str(context.label);
    var format = detectDateFormat(target, context);
    if (format === 'ambiguous') {
      return { value: '', skip: true, format: 'ambiguous', reason: 'ambiguous_date_order' };
    }

    // Already a bare part (e.g. resolve handed us "06" for a day box) — keep it.
    var raw = trim(value);
    if (
      (format === 'year' && /^\d{4}$/.test(raw)) ||
      (format === 'month' && /^\d{1,2}$/.test(raw)) ||
      (format === 'day' && /^\d{1,2}$/.test(raw))
    ) {
      var n = Number(raw);
      if (format === 'year') return { value: raw, skip: false, format: format };
      if (format === 'month' && n >= 1 && n <= 12) {
        return { value: pad2(n), skip: false, format: format };
      }
      if (format === 'day' && n >= 1 && n <= 31) {
        return { value: pad2(n), skip: false, format: format };
      }
    }

    var parts = parseDateParts(value);
    if (!parts) return { value: '', skip: true };

    var fromMap = formatsMapValue(context.formats, format);
    if (fromMap) {
      return { value: fromMap, skip: false, format: format, source: 'formats_map' };
    }

    var sep = (
      str(c.placeholder).match(/[\/.-]/) ||
      str(c.pattern).match(/[\/.-]/) ||
      ['/']
    )[0];
    var built = buildDateString(parts, format, sep);
    if (!built) return { value: '', skip: true };

    var isoFallback = buildDateString(parts, 'iso', '-');
    var ordered =
      format === 'iso' || format === 'ymd' || format === 'year' || format === 'month' || format === 'day'
        ? [built]
        : [built, isoFallback];
    for (var i = 0; i < ordered.length; i++) {
      if (matchesPattern(ordered[i], c.pattern) && fitsLength(ordered[i], c.maxLength)) {
        return { value: ordered[i], skip: false, format: i === 0 ? format : 'iso' };
      }
    }
    return { value: built, skip: false, format: format };
  }

  /**
   * Serialize profile / knowledge values for text controls.
   * Root cause of "[object Object]": String(arrayOfObjects) / String(object)
   * on education / certifications / experience entries.
   */
  function serializeStructuredRow(row) {
    if (row == null) return '';
    if (typeof row !== 'object') return String(row);
    if (row.degree || row.school || row.fieldOfStudy || row.institution) {
      return [row.degree, row.fieldOfStudy, row.school || row.institution, row.end || row.endYear || row.year]
        .filter(Boolean)
        .join(' · ');
    }
    if (row.name || row.issuer || row.certification) {
      return [row.name || row.certification, row.issuer, row.year].filter(Boolean).join(' · ');
    }
    if (row.title || row.company || row.role) {
      return [row.title || row.role, row.company, [row.start, row.end].filter(Boolean).join(' – ')]
        .filter(Boolean)
        .join(' · ');
    }
    if (row.label != null && typeof row.label !== 'object') return String(row.label);
    if (row.displayValue != null && typeof row.displayValue !== 'object') return String(row.displayValue);
    if (row.value != null && typeof row.value !== 'object') return String(row.value);
    if (row.text != null && typeof row.text !== 'object') return String(row.text);
    if (row.answer != null && typeof row.answer !== 'object') return String(row.answer);
    try {
      return JSON.stringify(row);
    } catch (_e) {
      return '';
    }
  }

  function serializeAnswer(value) {
    if (value == null) return '';
    var t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (!value.length) return '';
      var primitives = true;
      for (var i = 0; i < value.length; i++) {
        if (value[i] != null && typeof value[i] === 'object') {
          primitives = false;
          break;
        }
      }
      if (primitives) {
        return value
          .filter(function (x) {
            return x != null && String(x).trim() !== '';
          })
          .map(String)
          .join(', ');
      }
      return value
        .map(serializeStructuredRow)
        .filter(function (line) {
          return line && String(line).trim() !== '' && String(line).indexOf('[object Object]') === -1;
        })
        .join('\n');
    }
    if (t === 'object') return serializeStructuredRow(value);
    return String(value);
  }

  /**
   * Compose postal address for single-line, multiline, or separate-field forms.
   * country ≠ nationality ≠ phoneCountry — callers pick the right profile key.
   */
  function composeAddress(profile, mode) {
    profile = profile || {};
    var line1 = trim(profile.addressLine1 || profile.street || profile.address || '');
    var line2 = trim(profile.addressLine2 || '');
    var city = trim(profile.city || '');
    var state = trim(profile.state || profile.province || '');
    var zip = trim(profile.zip || profile.postalCode || profile.postcode || '');
    var country = trim(
      profile.addressCountry || profile.countryOfResidence || profile.country || ''
    );
    var cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (mode === 'parts') {
      return {
        line1: line1,
        line2: line2,
        city: city,
        state: state,
        zip: zip,
        country: country,
        cityStateZip: cityStateZip,
        single: [line1, line2, cityStateZip, country].filter(Boolean).join(', '),
        multiline: [line1, line2, cityStateZip, country].filter(Boolean).join('\n')
      };
    }
    var lines = [line1, line2, cityStateZip, country].filter(Boolean);
    if (mode === 'multiline') return lines.join('\n');
    return lines.join(', ');
  }

  /**
   * Prefer explicit first/last. When only a full name exists, First = first
   * token and Last = the rest — never the final token alone
   * ("Alex Sample Ali" → Last="Sample Ali", not "Ali").
   */
  function nameParts(profile) {
    profile = profile || {};
    var first = trim(profile.firstName || profile.first_name || '');
    var middle = trim(profile.middleName || profile.middle_name || '');
    var last = trim(profile.lastName || profile.last_name || '');
    var full = trim(
      profile.fullName ||
        profile.full_name ||
        [first, middle, last].filter(Boolean).join(' ')
    );
    if ((!first || !last) && full) {
      var tokens = full.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        if (!first) first = tokens[0];
      } else if (tokens.length >= 2) {
        if (!first) first = tokens[0];
        if (!last) last = tokens.slice(1).join(' ');
      }
    }
    if (!full) full = [first, middle, last].filter(Boolean).join(' ');
    return { first: first, middle: middle, last: last, full: full };
  }

  /** Digits for a numeric control: "25000 AED" → "25000", clamped to min/max. */
  function formatNumber(target, value) {
    var c = constraintsOf(target);
    var cleaned = str(value)
      .replace(CURRENCY_RE, '')
      .replace(/[£$€¥₹﷼]/g, '')
      .replace(/,/g, '')
      .replace(/\s+/g, '');
    var match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return { value: '', skip: true };
    var num = Number(match[0]);
    if (!Number.isFinite(num)) return { value: '', skip: true };

    var stepIsInteger = c.step === '' || c.step == null || /^\d+$/.test(String(c.step));
    if (stepIsInteger && c.type === 'number') num = Math.round(num);

    var min = numberAttr(c.min);
    var max = numberAttr(c.max);
    if (min != null && num < min) num = min;
    if (max != null && num > max) num = max;

    var out = String(num);
    if (c.maxLength && out.length > c.maxLength) {
      return { value: out.slice(0, c.maxLength), skip: false, format: 'number_truncated' };
    }
    return { value: out, skip: false, format: 'number' };
  }

  /** A control that will only accept digits, whatever the question was about. */
  function isNumericControl(target) {
    var c = constraintsOf(target);
    if (c.type === 'number' || c.type === 'range') return true;
    if (c.inputMode === 'numeric' || c.inputMode === 'decimal') return true;
    return /^\\d|\[0-9\]/.test(c.pattern);
  }

  function formatName(target, value) {
    var c = constraintsOf(target);
    var raw = trim(value).replace(/\s*,\s*$/, '');
    if (!raw) return { value: '', skip: true };
    if (c.maxLength && raw.length > c.maxLength) {
      return { value: raw.slice(0, c.maxLength), skip: false, format: 'truncated' };
    }
    return { value: raw, skip: false, format: 'name' };
  }

  /** Long answers into short boxes: cut on a word boundary, not mid-word. */
  function formatText(target, value) {
    var c = constraintsOf(target);
    var raw = str(value);
    if (!raw.trim()) return { value: '', skip: true };
    if (!c.maxLength || raw.length <= c.maxLength) {
      return { value: raw, skip: false, format: 'text' };
    }
    var cut = raw.slice(0, c.maxLength);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > c.maxLength * 0.6) cut = cut.slice(0, lastSpace);
    return { value: cut.replace(/[\s,;:]+$/, ''), skip: false, format: 'truncated' };
  }

  /**
   * Every spelling of a value a select might offer, best first, so option
   * matching can try "AE" when the profile says "United Arab Emirates" and
   * "Master's Degree" when it says "Master's / MBA".
   */
  function valueVariants(value, kind) {
    var out = [];
    var raw = trim(value);
    if (!raw) return out;
    out.push(raw);

    if (kind === 'state') {
      var vLower = lower(raw);
      for (var s = 0; s < US_STATES.length; s++) {
        if (lower(US_STATES[s][0]) === vLower) out.push(US_STATES[s][1]);
        else if (lower(US_STATES[s][1]) === vLower) out.push(US_STATES[s][0]);
      }
      return dedupe(out);
    }

    if (kind === 'educationLevel') {
      var level = educationLevel(raw);
      if (level) out = out.concat(level.spellings);
      return dedupe(out);
    }

    if (kind === 'noticePeriod') {
      if (isImmediateNotice(raw)) out = out.concat(IMMEDIATE_NOTICE);
      return dedupe(out);
    }

    if (kind === 'yearsExperience') {
      var years = numberIn(raw);
      if (years != null) {
        out.push(String(years), years + '+', years + ' years', 'More than ' + years + ' years');
      }
      return dedupe(out);
    }

    if (kind === 'gender') {
      var g = lower(raw);
      if (g === 'male' || g === 'm' || g === 'man') out.push('Male', 'M', 'Man', 'male', 'man');
      else if (g === 'female' || g === 'f' || g === 'woman') out.push('Female', 'F', 'Woman', 'female', 'woman');
      else if (g === 'non-binary' || g === 'nonbinary' || g === 'non binary') {
        out.push('Non-binary', 'Nonbinary', 'Non binary', 'Other');
      }
      return dedupe(out);
    }

    if (kind === 'salutation' || kind === 'title' || kind === 'honorific') {
      // Profile often stores "Mr." while selects offer "Mr"
      out.push(raw.replace(/\.+$/, ''), raw);
      var bare = lower(raw).replace(/\.+$/, '');
      if (bare === 'mr') out.push('Mr', 'Mr.', 'Mister');
      if (bare === 'mrs') out.push('Mrs', 'Mrs.');
      if (bare === 'ms') out.push('Ms', 'Ms.', 'Miss');
      if (bare === 'miss') out.push('Miss', 'Ms', 'Ms.');
      if (bare === 'dr' || bare === 'doctor') out.push('Dr', 'Dr.', 'Doctor');
      if (bare === 'sir') out.push('Sir');
      return dedupe(out);
    }

    if (kind === 'phoneCountry') {
      var parts = phoneParts({ phoneCountry: raw, phone: '' });
      if (parts.dial) out.push(parts.dial, parts.dialDigits, '+' + parts.dialDigits);
      var byDial = countryByDial(parts.dialDigits || raw);
      var country = byDial || findCountry(raw);
      if (country) {
        out.push(country.name, country.demonym, country.iso2, country.iso3, '+' + country.dial, country.dial);
        // Token match: "Saudi" from "Saudi Arabia", option text "+966 Saudi Arabia".
        String(country.name)
          .split(/\s+/)
          .forEach(function (tok) {
            if (tok.length > 3) out.push(tok);
          });
        (country.aka || []).forEach(function (a) {
          out.push(a, String(a).toUpperCase());
        });
        out.push(country.name + ' (' + parts.dial + ')');
        out.push(parts.dial + ' ' + country.name);
        out.push('+' + country.dial + ' ' + country.name);
      }
      return dedupe(out);
    }

    if (kind === 'nationality' || kind === 'residence' || kind === 'country') {
      var country2 = findCountry(raw);
      if (country2) {
        if (kind === 'nationality') {
          // Prefer demonym for nationality/citizenship selects.
          out.push(country2.demonym, country2.name, country2.iso2, country2.iso3);
        } else {
          // Residence and country: prefer country name, never dial codes.
          out.push(country2.name, country2.iso2, country2.iso3, country2.demonym);
        }
        (country2.aka || []).forEach(function (a) {
          out.push(a, String(a).toUpperCase());
        });
      }
      return dedupe(out);
    }

    var country = findCountry(raw);
    if (country) {
      // Unknown country-like control: offer both name and demonym (never dial).
      out.push(country.name, country.demonym, country.iso2, country.iso3);
      country.aka.forEach(function (a) {
        out.push(a.toUpperCase());
      });
    }
    return dedupe(out);
  }

  /** First number in a string: "15+ years" → 15, "10 or more" → 10. */
  function numberIn(value) {
    var m = str(value).match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function isImmediateNotice(value) {
    return /\b(immediate|immediately|on ?spot|right away|now|available now|no notice|0 days?)\b/i.test(
      str(value)
    );
  }

  function educationLevel(value) {
    var v = lower(value);
    if (!v) return null;
    for (var i = 0; i < EDUCATION_LEVELS.length; i++) {
      if (EDUCATION_LEVELS[i].match.test(v)) return EDUCATION_LEVELS[i];
    }
    return null;
  }

  function educationRank(value) {
    var level = educationLevel(value);
    return level ? level.rank : null;
  }

  /**
   * Read an option label as a numeric range: "3-5", "10+", "More than 10
   * years", "Less than 1 year", "None". Returns null when the label is not a
   * bucket at all.
   */
  function parseBucket(label) {
    var t = lower(label).replace(/[,]/g, '');
    if (!t) return null;
    if (/\b(none|no experience|not applicable|n\/a)\b/.test(t)) return { min: 0, max: 0 };

    var range = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to|through)\s*(\d+(?:\.\d+)?)/);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };

    var atLeast = t.match(/(?:more than|over|at least|greater than|minimum(?: of)?|>=?)\s*(\d+(?:\.\d+)?)/);
    if (atLeast) return { min: Number(atLeast[1]), max: Infinity };

    var orMore = t.match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|and above|and over|or above|plus)\b/);
    if (orMore) return { min: Number(orMore[1]), max: Infinity };
    if (/^\s*(\d+(?:\.\d+)?)\s*\+/.test(t)) return { min: numberIn(t), max: Infinity };

    var atMost = t.match(/(?:less than|under|below|fewer than|up to|at most|<=?)\s*(\d+(?:\.\d+)?)/);
    if (atMost) return { min: 0, max: Number(atMost[1]), exclusiveMax: /less than|under|below|fewer than/.test(t) };

    var bare = t.match(/^\D*(\d+(?:\.\d+)?)\D*$/);
    if (bare) return { min: Number(bare[1]), max: Number(bare[1]) };

    return null;
  }

  function bucketContains(bucket, n) {
    if (!bucket) return false;
    if (n < bucket.min) return false;
    if (bucket.exclusiveMax) return n < bucket.max;
    return n <= bucket.max;
  }

  function bucketWidth(bucket) {
    return bucket.max === Infinity ? Infinity : bucket.max - bucket.min;
  }

  /**
   * Index of the bucket option holding `value`, tightest bucket first so an
   * answer of 10 lands in "5-10" rather than in "10+".
   */
  function matchBucketIndex(labels, value) {
    var n = numberIn(value);
    if (n == null) return -1;
    var bestIdx = -1;
    var bestWidth = Infinity;
    for (var i = 0; i < labels.length; i++) {
      var bucket = parseBucket(labels[i]);
      if (!bucketContains(bucket, n)) continue;
      var width = bucketWidth(bucket);
      if (bestIdx === -1 || width < bestWidth) {
        bestIdx = i;
        bestWidth = width;
      }
    }
    return bestIdx;
  }

  /**
   * Index of the education option matching `value`. Exact level wins; failing
   * that the highest level below it, which the applicant also holds. Never a
   * level above it.
   */
  function matchEducationIndex(labels, value) {
    var want = educationRank(value);
    if (want == null) return -1;
    var bestIdx = -1;
    var bestRank = -1;
    for (var i = 0; i < labels.length; i++) {
      var rank = educationRank(labels[i]);
      if (rank == null || rank > want) continue;
      if (rank === want) return i;
      if (rank > bestRank) {
        bestRank = rank;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Last-resort option matching for selects, listboxes and radio groups, used
   * once plain text matching and the spelling variants have both missed.
   * Returns { index, how } or null.
   */
  function matchOptionIndex(labels, value, kind) {
    var list = (labels || []).map(function (l) {
      return trim(l);
    });
    if (!list.length || isBlank(value)) return null;

    if (kind === 'educationLevel') {
      var edu = matchEducationIndex(list, value);
      if (edu !== -1) return { index: edu, how: 'education_level' };
    }

    if (kind === 'yearsExperience' || kind === 'number' || kind === 'salary') {
      var bucket = matchBucketIndex(list, value);
      if (bucket !== -1) return { index: bucket, how: 'bucket' };
    }

    var variants = valueVariants(value, kind);
    for (var v = 0; v < variants.length; v++) {
      var wanted = lower(variants[v]);
      for (var i = 0; i < list.length; i++) {
        if (lower(list[i]) === wanted) return { index: i, how: 'variant_exact' };
      }
    }
    for (var v2 = 0; v2 < variants.length; v2++) {
      var want2 = lower(variants[v2]);
      if (want2.length < 2) continue;
      for (var j = 0; j < list.length; j++) {
        if (lower(list[j]).indexOf(want2) !== -1) return { index: j, how: 'variant_contains' };
      }
    }

    // A bucketed answer with no kind to go on: "15+" against "10+ years".
    var numeric = matchBucketIndex(list, value);
    if (numeric !== -1 && numberIn(value) != null) return { index: numeric, how: 'bucket' };

    return null;
  }

  function dedupe(list) {
    var seen = {};
    return list.filter(function (item) {
      var k = lower(item);
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  /**
   * Shape `value` for `target`.
   *
   * context: { key, profile, hasPhoneCountryField, country }
   * Returns { value, skip, kind, format }. `skip` means the control should be
   * left alone rather than filled with something it will reject.
   */
  function formatForField(target, value, context) {
    context = context || {};
    var profile = context.profile || {};
    var kind = context.kind || fieldKind(target, context.key);
    var result;

    if (isBlank(value)) {
      return { value: '', skip: true, kind: kind, format: 'blank' };
    }

    // Merge descriptor label into a plain descriptor when formatting dates.
    if (context.label && target && typeof target === 'object' && !target.tagName) {
      target = Object.assign({}, target, { label: context.label });
    }

    switch (kind) {
      case 'phone':
        // Merge the resolved answer with profile phoneFull / phoneCountry so a
        // single Phone box gets E.164 even when the answer was stored national.
        result = formatPhone(
          target,
          phoneParts({
            phone: value,
            phoneCountry: profile.phoneCountry || profile.phoneCountryCode,
            phoneFull: profile.phoneFull || profile.phoneE164,
            phoneE164: profile.phoneE164 || profile.phoneFull
          }),
          { hasCountryField: !!context.hasPhoneCountryField }
        );
        break;
      case 'phoneCountry':
        result = formatPhoneCountry(
          target,
          phoneParts({
            phone: profile.phone,
            phoneCountry: value,
            phoneFull: profile.phoneFull || profile.phoneE164
          })
        );
        break;
      case 'postal':
        result = formatPostal(target, value, { country: context.country || profile.country });
        break;
      case 'email':
        result = formatEmail(target, value);
        break;
      case 'url':
        result = formatUrl(target, value);
        break;
      case 'date':
        result = formatDate(target, value, context);
        break;
      case 'number':
        result = formatNumber(target, value);
        break;
      case 'name':
        result = formatName(target, value);
        break;
      case 'yearsExperience':
      case 'salary':
        // "15+" and "25000 SAR" are answers a text box takes as written, but a
        // numeric control rejects everything except the bare number.
        result = isNumericControl(target) ? formatNumber(target, value) : formatText(target, value);
        break;
      case 'country':
      case 'state':
      case 'educationLevel':
      case 'noticePeriod':
      case 'gender':
        result = formatText(target, value);
        break;
      default:
        result = formatText(target, value);
    }

    result = result || { value: '', skip: true };
    result.kind = kind;
    return result;
  }

  global.FillApplyFormat = {
    COUNTRIES: COUNTRIES,
    US_STATES: US_STATES,
    EDUCATION_LEVELS: EDUCATION_LEVELS,
    constraintsOf: constraintsOf,
    fieldKind: fieldKind,
    optionsLookLikeDialCodes: optionsLookLikeDialCodes,
    isNumericControl: isNumericControl,
    educationLevel: educationLevel,
    educationRank: educationRank,
    parseBucket: parseBucket,
    matchBucketIndex: matchBucketIndex,
    matchEducationIndex: matchEducationIndex,
    matchOptionIndex: matchOptionIndex,
    isImmediateNotice: isImmediateNotice,
    matchesPattern: matchesPattern,
    maskSlots: maskSlots,
    applyMask: applyMask,
    findCountry: findCountry,
    splitDial: splitDial,
    phoneParts: phoneParts,
    formatPhone: formatPhone,
    formatPhoneCountry: formatPhoneCountry,
    formatPostal: formatPostal,
    formatUrl: formatUrl,
    formatEmail: formatEmail,
    parseDateParts: parseDateParts,
    dateOrderFrom: dateOrderFrom,
    detectDateFormat: detectDateFormat,
    buildDateString: buildDateString,
    formatDate: formatDate,
    formatsMapValue: formatsMapValue,
    nameParts: nameParts,
    serializeAnswer: serializeAnswer,
    serializeStructuredRow: serializeStructuredRow,
    composeAddress: composeAddress,
    formatNumber: formatNumber,
    formatName: formatName,
    formatText: formatText,
    valueVariants: valueVariants,
    formatForField: formatForField
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
