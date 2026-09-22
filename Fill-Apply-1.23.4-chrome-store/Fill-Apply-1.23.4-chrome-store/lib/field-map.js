/**
 * Map profile keys to autocomplete / name / id / label / placeholder patterns.
 * Attaches API to globalThis.FillApplyFieldMap.
 */
(function (global) {
  'use strict';

  const FIELD_MAP = [
    {
      key: 'fullName',
      autocomplete: ['name'],
      names: ['fullname', 'full_name', 'full-name', 'applicant_name', 'your_name', 'name'],
      labels: ['full name', 'your name', 'legal name', 'applicant name'],
      placeholders: ['full name', 'your name']
    },
    {
      key: 'firstName',
      autocomplete: ['given-name'],
      names: [
        'firstname',
        'first_name',
        'first-name',
        'fname',
        'givenname',
        'given_name',
        'given-name',
        'applicant_first_name',
        'candidate_first_name'
      ],
      labels: [
        'first name',
        'given name',
        'forename',
        'what is your first name',
        'legal first name'
      ],
      // Bare "Name" is Michael Page's first-name placeholder (Last Name is separate).
      placeholders: ['first name', 'given name', 'forename', 'name']
    },
    {
      key: 'lastName',
      autocomplete: ['family-name'],
      names: [
        'lastname',
        'last_name',
        'last-name',
        'lname',
        'surname',
        'familyname',
        'family_name',
        'family-name',
        'applicant_last_name',
        'candidate_last_name'
      ],
      labels: [
        'last name',
        'family name',
        'surname',
        'what is your last name',
        'legal last name',
        'legal surname'
      ],
      placeholders: ['last name', 'surname', 'family name']
    },
    {
      key: 'email',
      autocomplete: ['email'],
      names: ['email', 'e-mail', 'emailaddress', 'email_address', 'user_email'],
      labels: ['email', 'e-mail', 'email address'],
      placeholders: ['email', 'you@example.com', 'email address']
    },
    {
      key: 'emailConfirm',
      autocomplete: ['email'],
      names: [
        'confirm_email',
        'retype_email',
        'email_confirm',
        'emailconfirm',
        'email2',
        'verify_email',
        'email_verification'
      ],
      labels: [
        'retype email',
        're-type email',
        'confirm email',
        'confirm e-mail',
        're-enter email',
        'verify email',
        'email again',
        'repeat email'
      ],
      placeholders: ['confirm email', 'retype email']
    },
    {
      key: 'password',
      autocomplete: ['new-password', 'current-password'],
      names: [
        'password',
        'passwd',
        'pwd',
        'choose_password',
        'account_password',
        'login_password',
        'user_password'
      ],
      labels: ['password', 'choose password', 'create password', 'account password', 'login password'],
      placeholders: ['password']
    },
    {
      key: 'passwordConfirm',
      autocomplete: ['new-password'],
      names: [
        'confirm_password',
        'retype_password',
        'password_confirm',
        'passwordconfirm',
        'password2',
        'password_reenter',
        'password_re_enter',
        'reenter_password'
      ],
      labels: [
        'retype password',
        're-type password',
        'confirm password',
        're-enter password',
        'reenter password',
        'password re-enter',
        'verify password',
        'repeat password'
      ],
      placeholders: ['confirm password', 'retype password']
    },
    {
      key: 'phone',
      autocomplete: ['tel'],
      names: ['phone', 'telephone', 'mobile', 'tel', 'phone_number', 'phonenumber', 'cell'],
      labels: ['phone', 'telephone', 'mobile', 'phone number', 'telephone number', 'cell'],
      placeholders: ['phone', 'mobile', 'telephone number', 'telephone', '(555)']
    },
    {
      key: 'location',
      // Do NOT claim street-address / address-line1 — those belong to street / address lines.
      autocomplete: [],
      names: ['location', 'current_location', 'city_state', 'based_in'],
      labels: ['current location', 'where are you based', 'location (city', 'location', 'city / location'],
      placeholders: ['city, state', 'location']
    },
    {
      key: 'city',
      autocomplete: ['address-level2'],
      names: ['city', 'town', 'city_or_town', 'cityortown'],
      labels: ['city', 'town', 'city or town', 'city/town', 'what city or town'],
      placeholders: ['city', 'town']
    },
    {
      key: 'state',
      autocomplete: ['address-level1'],
      names: ['state', 'province', 'region'],
      labels: ['state', 'province', 'region'],
      placeholders: ['state', 'province']
    },
    {
      key: 'country',
      autocomplete: ['country-name', 'country'],
      names: ['country', 'country_name', 'country_of_residence'],
      labels: ['country', 'country of residence', 'country/region of residence', 'what country do you live', 'country region of residence'],
      placeholders: ['country']
    },
    {
      key: 'countryOfResidence',
      autocomplete: [],
      names: ['country_of_residence', 'residence_country', 'residential_country', 'countryOfResidence'],
      labels: [
        'country of residence',
        'country/region of residence',
        'what country do you live',
        'country region of residence',
        'residential country'
      ],
      placeholders: ['country of residence']
    },
    {
      key: 'zip',
      autocomplete: ['postal-code'],
      names: ['zip', 'zipcode', 'zip_code', 'postal', 'postalcode', 'postal_code'],
      labels: ['zip', 'postal', 'postal code', 'zip code'],
      placeholders: ['zip', 'postal']
    },
    {
      key: 'street',
      autocomplete: ['street-address', 'address-line1'],
      names: ['street', 'street_address', 'streetaddress', 'address1', 'address_line1'],
      labels: ['street', 'street address', 'address line 1'],
      placeholders: ['street', 'address']
    },
    {
      key: 'postcode',
      autocomplete: ['postal-code'],
      names: ['postcode', 'postal_code', 'postal'],
      labels: ['postcode', 'postal code', 'postal'],
      placeholders: ['postcode', 'postal']
    },
    {
      key: 'phoneCountry',
      autocomplete: ['tel-country-code'],
      names: [
        'phone_country',
        'phonecountry',
        'country_code',
        'dial_code',
        'calling_code',
        'phoneCountry',
        'phone_country_code',
        'countrycode',
        'country_region_code',
        'countryRegionCode'
      ],
      labels: [
        'phone country',
        'country code',
        'dial code',
        'calling code',
        'phone country code',
        'country for phone',
        'mobile country',
        'country/region code',
        'country / region code',
        'country region code',
        'region code'
      ],
      placeholders: ['+971', '+1', '+966']
    },
    {
      key: 'linkedin',
      autocomplete: ['url'],
      names: ['linkedin', 'linkedin_url', 'linkedinurl', 'linked_in'],
      labels: ['linkedin', 'linkedin url', 'linkedin profile'],
      placeholders: ['linkedin.com']
    },
    {
      key: 'portfolio',
      autocomplete: ['url'],
      names: ['portfolio', 'portfolio_url', 'portfoliourl'],
      labels: ['portfolio', 'portfolio url', 'portfolio website'],
      placeholders: ['portfolio']
    },
    {
      key: 'website',
      autocomplete: ['url'],
      names: ['website', 'personal_website', 'homepage', 'site'],
      labels: ['website', 'personal website', 'personal site'],
      placeholders: ['https://']
    },
    {
      key: 'github',
      autocomplete: ['url'],
      names: ['github', 'github_url', 'githuburl'],
      labels: ['github', 'github url', 'github profile'],
      placeholders: ['github.com']
    },
    {
      key: 'resumeUrl',
      autocomplete: [],
      names: ['resume_url', 'resumeurl', 'cv_url', 'resume_link'],
      labels: ['resume url', 'resume link', 'cv url', 'link to resume', 'curriculum vitae url'],
      placeholders: ['resume url', 'link to resume']
    },
    {
      key: 'coverUrl',
      autocomplete: [],
      names: ['cover_url', 'coverurl', 'cover_letter_url', 'cover_link'],
      labels: ['cover letter url', 'cover url', 'cover letter link'],
      placeholders: ['cover letter url']
    },
    /* --- Identity extras ------------------------------------------------ *
     * Ordered before the long-form entries below on purpose: "Job title" and
     * "Years of experience" would otherwise be swallowed by the broad
     * `workHistory` and `education` entries, which match on single words.
     */
    {
      key: 'middleName',
      autocomplete: ['additional-name'],
      names: ['middlename', 'middle_name', 'middle-name', 'mname'],
      labels: ['middle name', 'middle initial'],
      placeholders: ['middle name']
    },
    {
      key: 'preferredName',
      autocomplete: ['nickname'],
      names: ['preferredname', 'preferred_name', 'nickname', 'known_as', 'goes_by'],
      labels: ['preferred name', 'nickname', 'known as', 'what should we call you'],
      placeholders: ['preferred name']
    },
    {
      key: 'salutation',
      autocomplete: ['honorific-prefix'],
      names: ['salutation', 'honorific', 'prefix', 'name_prefix'],
      labels: ['salutation', 'honorific', 'name prefix', 'courtesy title', 'title'],
      placeholders: ['mr', 'ms']
    },
    {
      key: 'title',
      autocomplete: ['honorific-prefix'],
      // names: bare "title" only — "current_title" / "job_title" belong to currentTitle
      names: ['title', 'name_title', 'salut', 'honorific_prefix'],
      labels: ['title', 'name title', 'salutation', 'courtesy title'],
      placeholders: ['mr', 'ms', 'mrs']
    },
    {
      key: 'addressLine1',
      autocomplete: ['address-line1'],
      names: ['address_line_1', 'addressline1', 'address1', 'addr1'],
      labels: ['address line 1', 'address 1', 'street address'],
      placeholders: ['address line 1']
    },
    {
      key: 'addressLine2',
      autocomplete: ['address-line2'],
      names: ['address_line_2', 'addressline2', 'address2', 'addr2'],
      labels: ['address line 2', 'address 2', 'apt', 'suite'],
      placeholders: ['address line 2']
    },
    {
      key: 'address',
      autocomplete: ['street-address'],
      names: ['address', 'full_address', 'mailing_address', 'postal_address', 'home_address'],
      labels: ['address', 'full address', 'mailing address', 'postal address', 'home address', 'your address'],
      placeholders: ['address', 'full address']
    },
    {
      key: 'addressFull',
      autocomplete: [],
      names: ['address_full', 'address_multiline', 'address_block'],
      labels: ['address (multiline)', 'full mailing address'],
      placeholders: []
    },
    {
      key: 'addressCountry',
      autocomplete: [],
      names: ['address_country', 'addresscountry'],
      labels: ['address country'],
      placeholders: []
    },
    {
      key: 'province',
      autocomplete: ['address-level1'],
      names: ['province', 'region', 'emirate'],
      labels: ['province', 'region', 'emirate', 'state/province'],
      placeholders: ['province']
    },
    {
      key: 'headline',
      autocomplete: [],
      names: ['headline', 'profile_headline', 'tagline'],
      labels: ['headline', 'professional headline', 'profile headline'],
      placeholders: ['headline']
    },
    {
      key: 'dateOfBirth',
      autocomplete: ['bday'],
      names: ['dob', 'dateofbirth', 'date_of_birth', 'birthdate', 'birth_date', 'birthday'],
      labels: [
        'date of birth',
        'birth date',
        'birthday',
        'dob',
        'date of birth (mm/dd/yyyy)',
        'date of birth (dd/mm/yyyy)'
      ],
      placeholders: ['mm/dd/yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd', 'date of birth']
    },
    {
      key: 'birthYear',
      autocomplete: ['bday-year'],
      names: ['birth_year', 'birthyear', 'dob_year', 'year_of_birth'],
      labels: ['birth year', 'year of birth', 'dob year'],
      placeholders: ['yyyy', 'year']
    },
    {
      key: 'birthMonth',
      autocomplete: ['bday-month'],
      names: ['birth_month', 'birthmonth', 'dob_month', 'month_of_birth'],
      labels: ['birth month', 'month of birth', 'dob month'],
      placeholders: ['mm', 'month']
    },
    {
      key: 'birthDay',
      autocomplete: ['bday-day'],
      names: ['birth_day', 'birthday_day', 'dob_day', 'day_of_birth'],
      labels: ['birth day', 'day of birth', 'dob day'],
      placeholders: ['dd', 'day']
    },

    /* --- Professional --------------------------------------------------- */
    {
      key: 'currentTitle',
      autocomplete: ['organization-title'],
      names: ['current_title', 'currenttitle', 'job_title', 'jobtitle', 'current_position', 'designation', 'current_role'],
      labels: [
        'current title',
        'current job title',
        'job title',
        'current position',
        'current role',
        'present designation',
        'designation',
        'most recent title'
      ],
      placeholders: ['job title', 'current title']
    },
    {
      key: 'currentCompany',
      autocomplete: ['organization'],
      names: ['current_company', 'currentcompany', 'current_employer', 'employer', 'company_name', 'organisation'],
      labels: [
        'current company',
        'current employer',
        'present employer',
        'most recent employer',
        'company name',
        'employer name'
      ],
      placeholders: ['company', 'employer']
    },
    {
      key: 'yearsExperience',
      autocomplete: [],
      names: ['years_experience', 'yearsexperience', 'years_of_experience', 'total_experience', 'experience_years'],
      labels: [
        'years of experience',
        'years experience',
        'total experience',
        'total years of experience',
        'experience (years)',
        'how many years of experience',
        'years of relevant experience'
      ],
      placeholders: ['years', 'e.g. 5']
    },
    {
      key: 'skills',
      autocomplete: [],
      names: ['skills', 'key_skills', 'technical_skills', 'core_skills'],
      labels: ['skills', 'key skills', 'technical skills', 'core competencies', 'areas of expertise'],
      placeholders: ['skills']
    },
    {
      key: 'languages',
      autocomplete: [],
      names: ['languages', 'language', 'languages_spoken'],
      labels: ['languages', 'languages spoken', 'language proficiency'],
      placeholders: ['languages']
    },
    {
      key: 'certifications',
      autocomplete: [],
      names: ['certifications', 'certificates', 'licenses', 'professional_certifications'],
      labels: ['certifications', 'certificates', 'professional certifications', 'licenses and certifications'],
      placeholders: ['certifications']
    },
    {
      key: 'references',
      autocomplete: [],
      names: ['references', 'reference_details'],
      labels: ['references', 'reference details', 'professional references'],
      placeholders: ['references']
    },

    /* --- Education ------------------------------------------------------ */
    {
      key: 'highestEducation',
      autocomplete: [],
      names: ['highest_education', 'education_level', 'highest_degree', 'highest_qualification', 'degree_level'],
      labels: [
        'highest education',
        'highest education level',
        'highest level of education',
        'level of education',
        'education level',
        'highest degree',
        'highest qualification',
        'highest academic qualification'
      ],
      placeholders: ['education level']
    },
    {
      key: 'school',
      autocomplete: [],
      names: ['school', 'university', 'college', 'institution', 'institute', 'school_name'],
      labels: ['school', 'university', 'college', 'institution', 'name of institution', 'school name'],
      placeholders: ['school', 'university']
    },
    {
      key: 'degree',
      autocomplete: [],
      names: ['degree', 'degree_type', 'qualification'],
      labels: ['degree', 'degree type', 'qualification obtained'],
      placeholders: ['degree']
    },
    {
      key: 'fieldOfStudy',
      autocomplete: [],
      names: ['field_of_study', 'fieldofstudy', 'major', 'discipline', 'specialization', 'specialisation'],
      labels: ['field of study', 'major', 'discipline', 'specialization', 'specialisation', 'area of study'],
      placeholders: ['field of study', 'major']
    },
    {
      key: 'graduationYear',
      autocomplete: [],
      names: ['graduation_year', 'graduationyear', 'year_of_graduation', 'grad_year', 'completion_year'],
      labels: ['graduation year', 'year of graduation', 'graduation date', 'year completed', 'completion year'],
      placeholders: ['yyyy', 'graduation year']
    },
    {
      key: 'gpa',
      autocomplete: [],
      names: ['gpa', 'cgpa', 'grade_point', 'grade'],
      labels: ['gpa', 'cgpa', 'grade point average', 'grade / result'],
      placeholders: ['gpa', '3.5']
    },

    /* --- Compensation and preferences ----------------------------------- */
    {
      key: 'currentSalary',
      autocomplete: [],
      names: ['current_salary', 'currentsalary', 'present_salary', 'current_ctc', 'current_monthly_salary', 'salary_amount'],
      labels: [
        'current salary',
        'current monthly salary',
        'what is your current monthly salary',
        'present salary',
        'current compensation',
        'current ctc',
        'salary amount'
      ],
      placeholders: ['current salary', 'salary amount']
    },
    {
      key: 'salaryCurrency',
      autocomplete: [],
      names: ['salary_currency', 'currency', 'salarycurrency', 'pay_currency'],
      labels: ['currency', 'salary currency', 'current salary currency', 'pay currency'],
      placeholders: ['currency', 'aed', 'sar', 'usd']
    },
    {
      key: 'salaryText',
      autocomplete: [],
      names: ['salary', 'salary_text', 'salarytext', 'compensation', 'pay', 'ctc'],
      labels: ['salary', 'compensation', 'pay', 'ctc', 'salary text', 'salary amount', 'current salary', 'current remuneration', 'remuneration', 'current ctc'],
      placeholders: ['salary', '3000 sar', 'compensation']
    },
    {
      key: 'expectedSalary',
      autocomplete: [],
      names: ['expected_salary', 'expectedsalary', 'salary_expectation', 'desired_salary', 'expected_ctc', 'pay_rate'],
      labels: [
        'expected salary',
        'salary expectation',
        'salary expectations',
        'desired salary',
        'expected compensation',
        'expected pay rate',
        'desired compensation'
      ],
      placeholders: ['expected salary']
    },
    {
      key: 'willingToRelocate',
      autocomplete: [],
      names: ['willing_to_relocate', 'relocate', 'relocation'],
      labels: ['willing to relocate', 'open to relocation', 'would you relocate', 'relocation'],
      placeholders: ['yes', 'no']
    },
    {
      key: 'remotePreference',
      autocomplete: [],
      names: ['remote_preference', 'work_preference', 'work_arrangement', 'work_setup'],
      labels: ['remote preference', 'work preference', 'work arrangement', 'onsite or remote', 'work setup'],
      placeholders: ['remote', 'hybrid']
    },
    {
      key: 'referralSource',
      autocomplete: [],
      names: ['referral_source', 'how_did_you_hear', 'how_heard', 'hear_about_us', 'lead_source', 'how_did_you_hear'],
      labels: [
        'how did you hear about us',
        'how did you hear about this',
        'how did you hear about this position',
        'how did you find',
        'where did you hear',
        'referral source',
        'source of application'
      ],
      placeholders: ['how did you hear', 'job board']
    },
    {
      key: 'termsOfUseAccepted',
      autocomplete: [],
      names: ['terms_of_use', 'terms_accepted', 'accept_terms', 'termsOfUseAccepted', 'terms_of_use_accepted'],
      labels: ['terms of use', 'i accept the terms', 'accept terms', 'terms and conditions'],
      placeholders: []
    },
    {
      key: 'privacyAccepted',
      autocomplete: [],
      names: ['privacy_accepted', 'accept_data_privacy', 'privacy_consent', 'data_privacy', 'privacyAccepted', 'qiddiya_privacy_ack'],
      labels: [
        'data privacy',
        'privacy policy',
        'privacy notice',
        'accept data privacy',
        'privacy',
        'i acknowledge the privacy',
        'privacy acknowledgement'
      ],
      placeholders: []
    },
    {
      key: 'conflictOfInterest',
      autocomplete: [],
      names: ['conflict_of_interest', 'conflictOfInterest', 'qic_conflict_of_interest'],
      labels: ['conflict of interest', 'any conflict of interest', 'do you have a conflict of interest'],
      placeholders: []
    },
    {
      key: 'workingForQiddiya',
      autocomplete: [],
      names: ['working_for_qiddiya', 'workingForQiddiya', 'currently_working_for_qiddiya'],
      labels: [
        'working for qiddiya',
        'currently involved or working directly for qiddiya',
        'are you currently involved or working directly for qiddiya',
        'work for qiddiya'
      ],
      placeholders: []
    },
    {
      key: 'workedForPifOrAffiliate',
      autocomplete: [],
      names: ['worked_for_pif_or_affiliate', 'pif_affiliate', 'workedForPifOrAffiliate'],
      labels: [
        'pif or one of its affiliated companies',
        'worked directly for pif',
        'pif or affiliate',
        'public investment fund'
      ],
      placeholders: []
    },
    {
      key: 'neverHadCriminalConviction',
      autocomplete: [],
      names: [
        'never_had_criminal_conviction',
        'criminal_conviction',
        'neverHadCriminalConviction'
      ],
      labels: [
        'never had any criminal conviction',
        'i hereby confirm that i have never had any criminal conviction',
        'criminal conviction',
        'criminal record'
      ],
      placeholders: []
    },
    {
      key: 'socialMedia',
      autocomplete: [],
      names: ['social_media', 'social_media_profiles', 'socialMedia', 'social_profiles'],
      labels: [
        'social media',
        'social media profiles',
        'do you have any social media accounts',
        'social media accounts',
        'social profile'
      ],
      placeholders: ['linkedin.com']
    },
    {
      key: 'driversLicense',
      autocomplete: [],
      names: ['drivers_license', 'driving_license', 'driving_licence', 'driver_licence'],
      labels: ["driver's license", 'drivers license', 'driving license', 'driving licence', 'valid license'],
      placeholders: ['yes', 'no']
    },

    {
      key: 'resumeSummary',
      autocomplete: [],
      names: ['summary', 'resume_summary', 'about', 'bio', 'profile_summary'],
      labels: ['summary', 'about you', 'professional summary', 'bio'],
      placeholders: ['brief summary', 'tell us about yourself']
    },
    {
      key: 'workHistory',
      autocomplete: [],
      names: ['work_history', 'experience', 'work_experience', 'employment'],
      labels: ['work history', 'work experience', 'employment history', 'describe your experience'],
      placeholders: ['describe your experience']
    },
    {
      key: 'education',
      autocomplete: [],
      names: ['education', 'education_history', 'education_summary', 'educational_background'],
      labels: ['education history', 'education summary', 'educational background', 'education'],
      placeholders: ['education']
    },
    {
      key: 'coverLetter',
      autocomplete: [],
      names: ['cover_letter', 'coverletter', 'cover', 'message', 'additional_info'],
      labels: ['cover letter', 'covering letter', 'motivation letter', 'letter of interest', 'why do you want', 'additional information', 'message'],
      placeholders: ['cover letter', 'tell us why']
    },
    {
      key: 'nationality',
      autocomplete: [],
      names: ['nationality', 'citizenship', 'citizen_of'],
      labels: ['nationality', 'citizenship', 'citizen of', 'for which country do you hold nationality', 'hold nationality', 'country of nationality'],
      placeholders: ['nationality']
    },
    {
      key: 'gender',
      autocomplete: ['sex'],
      names: ['gender', 'sex', 'gender_identity', 'genderidentity'],
      labels: ['gender', 'sex', 'gender identity', 'gender identity (optional)'],
      placeholders: ['gender', 'select gender']
    },
    {
      key: 'noticePeriod',
      autocomplete: [],
      names: ['notice_period', 'noticeperiod', 'availability', 'start_availability'],
      labels: [
        'notice period',
        'when can you start',
        'earliest start',
        'i can start immediately',
        'available',
        'availability',
        'available immediately',
        'availability status'
      ],
      placeholders: ['notice period', 'immediately', 'available']
    },
    {
      key: 'authorizedToWork',
      autocomplete: [],
      names: [
        'authorized_to_work',
        'work_authorization',
        'work_auth',
        'legally_authorized',
        'eligible_to_work'
      ],
      labels: [
        'authorized to work',
        'legally authorized',
        'eligible to work',
        'work authorization',
        'right to work',
        'permitted to work',
        'are you authorized'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'requiresSponsorship',
      autocomplete: [],
      names: [
        'requires_sponsorship',
        'sponsorship',
        'need_sponsorship',
        'visa_sponsorship',
        'require_visa'
      ],
      labels: [
        'require sponsorship',
        'requires sponsorship',
        'need sponsorship',
        'visa sponsorship',
        'will you now or in the future require sponsorship',
        'sponsorship'
      ],
      placeholders: ['yes', 'no']
    },
    /**
     * Last on purpose. "When can you start" is answered by the notice period
     * above; this entry only exists for controls that want an actual date.
     */
    {
      key: 'experienceLevel',
      autocomplete: [],
      names: ['experience_level', 'experiencelevel', 'seniority', 'career_level'],
      labels: [
        'experience level',
        'seniority',
        'career level',
        'what is your experience level',
        'your experience level',
        'select experience level'
      ],
      placeholders: ['experience level', 'director', 'manager', 'senior']
    },
    {
      key: 'sector',
      autocomplete: [],
      names: ['sector', 'industry_sector', 'job_sector'],
      labels: ['sector', 'which sector', 'which sector do you work', 'industry sector'],
      placeholders: ['sector']
    },
    {
      key: 'subSector',
      autocomplete: [],
      names: ['sub_sector', 'subsector', 'sub-sector'],
      labels: ['sub-sector', 'sub sector', 'which sub-sector', 'which sub-sector do you work'],
      placeholders: ['sub-sector', 'sub sector']
    },
    {
      key: 'middleEastWorkingVisa',
      autocomplete: [],
      names: [
        'middle_east_working_visa',
        'working_visa_middle_east',
        'me_working_visa',
        'middleeastworkingvisa'
      ],
      labels: [
        'working visa for the middle east',
        'working visa for middle east',
        'do you currently have a working visa for the middle east',
        'middle east working visa',
        'middle east visa',
        'me working visa'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'qualifiedCaOrAcca',
      autocomplete: [],
      names: ['qualified_ca_or_acca', 'ca_or_acca', 'qualifiedcaoracca'],
      labels: [
        'are you a qualified ca or acca',
        'qualified ca or acca',
        'ca or acca',
        'ca / acca'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'qualifiedCa',
      autocomplete: [],
      names: ['qualified_ca', 'qualifiedca', 'ca_only', 'chartered_accountant'],
      labels: [
        'are you a qualified chartered accountant (ca)',
        'are you a qualified chartered accountant',
        'qualified chartered accountant (ca)',
        'qualified chartered accountant'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'bcomOrMcom',
      autocomplete: [],
      names: ['bcom_or_mcom', 'bcom', 'mcom', 'bachelor_commerce'],
      labels: [
        'b.com or m.com',
        'bcom or mcom',
        'bachelor of commerce',
        "bachelor's degree in commerce",
        'do you hold a bachelor’s degree in commerce'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'erpExperience',
      autocomplete: [],
      names: ['erp_experience', 'erpexperience', 'erp'],
      labels: [
        'erp experience',
        'experience with erp',
        'practical experience working with erp',
        'erp/accounting software',
        'do you have practical experience working with erp'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'candidateOrClient',
      autocomplete: [],
      names: ['candidate_or_client', 'candidateorclient', 'client_or_candidate'],
      labels: [
        'client or candidate',
        'candidate or client',
        'please select the option that best fits you',
        'are you a candidate or a client'
      ],
      placeholders: ['candidate', 'client']
    },
    {
      key: 'currentRemuneration',
      autocomplete: [],
      names: ['current_remuneration', 'remuneration', 'currentremuneration'],
      labels: [
        'current remuneration',
        'what is your current remuneration',
        'remuneration'
      ],
      placeholders: ['remuneration', 'salary']
    },
    {
      key: 'previousAlfuttaimEmployee',
      autocomplete: [],
      names: ['previous_alfuttaim_employee', 'previousalfuttaim'],
      labels: [
        'previous al-futtaim group employee',
        'are you a previous al-futtaim group employee',
        'previous al-futtaim employee'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'currentlyEmployedAlfuttaim',
      autocomplete: [],
      names: ['currently_employed_alfuttaim', 'current_alfuttaim'],
      labels: [
        'currently employed with any al-futtaim',
        'are you currently employed with any al-futtaim group company',
        'current al-futtaim employee'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'familyMembersAlfuttaim',
      autocomplete: [],
      names: ['family_members_alfuttaim', 'alfuttaim_family'],
      labels: [
        'family members in the al-futtaim group',
        'do you have any family members in the al-futtaim group',
        'relatives at al-futtaim'
      ],
      placeholders: ['yes', 'no']
    },
    {
      key: 'phoneFull',
      autocomplete: ['tel'],
      names: ['phone_full', 'phonefull', 'phone_e164', 'phonee164', 'full_phone'],
      labels: [
        'phone with country code',
        'full phone',
        'full phone number',
        'complete phone number',
        'phone e164'
      ],
      placeholders: ['+966', '+1', 'e.164']
    },
    {
      key: 'availableFrom',
      autocomplete: [],
      names: ['available_from', 'availablefrom', 'start_date', 'startdate', 'joining_date', 'available_start_date'],
      labels: [
        'available from',
        'availability date',
        'available start date',
        'earliest available date',
        'desired start date',
        'start date',
        'joining date',
        'available to start',
        'when are you available to start',
        'when can you start'
      ],
      placeholders: ['dd/mm/yyyy', 'start date']
    }
  ];

  function normalize(str) {
    return String(str || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Whole-phrase / word-bounded contains for short field-map labels. */
  function containsPhrase(hay, needle) {
    if (!hay || !needle) return false;
    hay = String(hay);
    needle = String(needle);
    if (hay === needle) return true;
    if (needle.length > 8) return hay.indexOf(needle) !== -1;
    return (' ' + hay + ' ').indexOf(' ' + needle + ' ') !== -1;
  }

  function scoreMatch(entry, descriptor) {
    let score = 0;
    const ac = normalize(descriptor.autocomplete);
    const n = normalize(descriptor.name);
    const i = normalize(descriptor.id);
    const lab = normalize(descriptor.label);
    const ph = normalize(descriptor.placeholder);
    const type = descriptor.type || '';

    (entry.autocomplete || []).forEach(function (a) {
      if (ac && ac === normalize(a)) score += 100;
    });
    (entry.names || []).forEach(function (p) {
      const pn = normalize(p);
      // Substring matching on very short tokens matches almost anything
      // ("e" inside "email", "edu" inside "education"), so the reverse
      // direction — the pattern containing the control's name — only
      // counts when that name is long enough to be more than a coincidence.
      function nameHits(token) {
        if (!token) return false;
        if (token === pn) return true;
        if (pn.length < 3 || token.length < 3) return false;
        // Never let bare "title" (honorific) match compound job-title patterns
        // in either direction: token=title↔pn=current_title / job_title.
        var titleCompound = /(current|job|position|role|designation)_?title|^title$/;
        if (token === 'title' && titleCompound.test(pn) && pn !== 'title') return false;
        if (pn === 'title' && titleCompound.test(token) && token !== 'title') return false;
        if (token.includes(pn)) return true;
        // Reverse contains: only when both sides are long and not a short
        // ambiguous token like "title" / "name" / "code".
        if (token.length >= 5 && pn.includes(token)) {
          if (/^(title|name|code|type|date|city|role)$/.test(token)) return false;
          return true;
        }
        return false;
      }
      if (nameHits(n)) score += 50;
      if (nameHits(i)) score += 40;
    });
    (entry.labels || []).forEach(function (p) {
      const pl = normalize(p);
      if (lab && containsPhrase(lab, pl)) score += 60;
    });
    (entry.placeholders || []).forEach(function (p) {
      const pp = normalize(p);
      if (ph && (ph === pp || ph.includes(pp))) score += 30;
    });

    if ((entry.key === 'title' || entry.key === 'salutation') && /\b(current|job|position|role|designation)\b/.test(lab)) {
      score = 0;
    }
    if (entry.key === 'title' && lab === 'title') score += 60;
    // Bare "Title" on apply forms is almost always Mr/Ms — not job title, not first name.
    if (lab === 'title' || lab === 'title *' || lab === 'title:') {
      if (entry.key === 'salutation' || entry.key === 'title') score += 120;
      if (entry.key === 'currentTitle') score = 0;
      if (entry.key === 'firstName' || entry.key === 'fullName') score = Math.max(0, score - 100);
    }
    if (entry.key === 'email' && type === 'email') score += 80;
    if (entry.key === 'phone' && (type === 'tel' || type === 'phone')) score += 80;
    // Retype / confirm email & password must win over bare email / password.
    var confirmish = /\b(re-?type|re-?enter|confirm|verify|repeat|again)\b/.test(lab + ' ' + n + ' ' + i);
    if (confirmish) {
      if (entry.key === 'emailConfirm') score += 100;
      if (entry.key === 'passwordConfirm') score += 100;
      if (entry.key === 'email') score = Math.max(0, score - 90);
      if (entry.key === 'password') score = Math.max(0, score - 90);
    } else {
      if (entry.key === 'emailConfirm') score = Math.max(0, score - 40);
      if (entry.key === 'passwordConfirm') score = Math.max(0, score - 40);
    }
    if (entry.key === 'password' && type === 'password' && !confirmish) score += 50;
    if (entry.key === 'passwordConfirm' && type === 'password' && confirmish) score += 50;
    // Country/Region Code (dial) vs residence country
    if (/country\s*\/?\s*region\s*code|region\s*code|dial\s*code|calling\s*code/.test(lab)) {
      if (entry.key === 'phoneCountry') score += 90;
      if (entry.key === 'country') score = Math.max(0, score - 50);
    }
    // "Experience Level" / seniority must not map to workHistory or yearsExperience.
    if (/\b(experience\s*level|seniority|career\s*level)\b/.test(lab)) {
      if (entry.key === 'experienceLevel') score += 80;
      if (entry.key === 'workHistory' || entry.key === 'yearsExperience') score = 0;
    }
    // Bare "Currency" on a salary step → salaryCurrency (not country).
    if (lab === 'currency' || lab === 'salary currency') {
      if (entry.key === 'salaryCurrency') score += 80;
      if (entry.key === 'country') score = Math.max(0, score - 40);
    }
    // Ignite-style short labels
    if (lab === 'name') {
      if (entry.key === 'fullName') score += 90;
      if (entry.key === 'firstName') score = Math.max(0, score - 40);
    }
    if (lab === 'salary' || lab === 'compensation' || lab === 'pay') {
      if (entry.key === 'salaryText') score += 90;
      if (entry.key === 'currentSalary' || entry.key === 'expectedSalary') score = Math.max(0, score - 30);
    }
    if (/\bexpected\b/.test(lab) && /\b(salary|compensation|pay|ctc|remuneration)\b/.test(lab)) {
      if (entry.key === 'expectedSalary') score += 140;
      if (entry.key === 'currentSalary' || entry.key === 'salaryText') score = Math.max(0, score - 80);
    }
    if (/\bcurrent\b/.test(lab) && /\b(salary|compensation|pay|ctc|remuneration)\b/.test(lab) && !/\bexpected\b/.test(lab)) {
      if (entry.key === 'currentSalary') score += 140;
      if (entry.key === 'expectedSalary' || entry.key === 'salaryText') score = Math.max(0, score - 80);
    }
    if (lab === 'address' || lab === 'full address' || lab === 'mailing address' || lab === 'postal address') {
      if (entry.key === 'address' || entry.key === 'addressFull') score += 120;
      if (entry.key === 'street' || entry.key === 'addressLine1') score = Math.max(0, score - 60);
    }
    if (/address\s*line\s*1|address\s*1/.test(lab) || /address_line_?1|addressline1|address1/.test(n + ' ' + i)) {
      if (entry.key === 'addressLine1') score += 100;
      if (entry.key === 'street' || entry.key === 'address') score = Math.max(0, score - 50);
    }
    if (/multiline|mailing address|address block/.test(lab) || /address_multiline|address_full|address_block/.test(n + ' ' + i)) {
      if (entry.key === 'addressFull') score += 130;
      if (entry.key === 'address' || entry.key === 'street') score = Math.max(0, score - 40);
    }
    if (lab === 'available' || lab === 'availability') {
      if (entry.key === 'noticePeriod') score += 90;
      if (entry.key === 'availableFrom') score = Math.max(0, score - 40);
    }
    if (lab === 'location') {
      if (entry.key === 'location') score += 80;
    }
    if (lab === 'phone' || lab === 'telephone' || lab === 'mobile') {
      if (entry.key === 'phone') score += 40;
    }
    if (
      ['linkedin', 'portfolio', 'website', 'github', 'resumeUrl'].indexOf(entry.key) !== -1 &&
      type === 'url'
    ) {
      score += 10;
    }

    return score;
  }

  function optionsLookLikeDialCodes(descriptor) {
    const opts = (descriptor && descriptor.options) || [];
    if (!opts.length) return false;
    let dialish = 0;
    const n = Math.min(opts.length, 40);
    for (let i = 0; i < n; i++) {
      const t = String((opts[i] && (opts[i].text || opts[i].label || opts[i].value)) || '');
      if (/\+\d{1,4}\b/.test(t) || /^\s*\d{1,4}\s*[-–/]/.test(t)) dialish += 1;
    }
    return dialish >= 3 || (dialish >= 1 && dialish / n >= 0.25);
  }

  function bestKeyForField(descriptor, minScore) {
    minScore = typeof minScore === 'number' ? minScore : 30;
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < FIELD_MAP.length; i++) {
      const entry = FIELD_MAP[i];
      let s = scoreMatch(entry, descriptor);
      // A Country* select whose options are dial codes is phoneCountry, not country.
      if (entry.key === 'phoneCountry' && optionsLookLikeDialCodes(descriptor)) {
        s += 80;
      }
      if (entry.key === 'country' && optionsLookLikeDialCodes(descriptor)) {
        s = Math.max(0, s - 40);
      }
      if (s > bestScore) {
        bestScore = s;
        best = entry.key;
      }
    }
    return bestScore >= minScore ? best : null;
  }

  /** Words that carry no meaning when comparing a stored question to a page label. */
  const STOP_WORDS = {
    a: 1, an: 1, the: 1, is: 1, are: 1, do: 1, does: 1, did: 1, you: 1, your: 1,
    yours: 1, we: 1, us: 1, our: 1, to: 1, of: 1, in: 1, on: 1, at: 1, for: 1,
    with: 1, and: 1, or: 1, if: 1, please: 1, what: 1, which: 1, how: 1, have: 1,
    has: 1, will: 1, would: 1, can: 1, any: 1, this: 1, that: 1, be: 1, been: 1,
    me: 1, my: 1, i: 1
  };

  function contentTokens(str) {
    return normalize(str)
      .replace(/[^a-z0-9\u0600-\u06ff ]+/g, ' ')
      .split(/\s+/)
      .filter(function (t) {
        return t && t.length > 1 && !STOP_WORDS[t];
      });
  }

  /**
   * Match a stored question to a page label.
   *
   * Pure substring matching fails on the common case: a source profile stores
   * "Current salary" while the page asks "What is your current salary?".
   * Comparing content words handles the wording drift both ways.
   */
  function matchCustomQA(customQA, label, placeholder) {
    if (!Array.isArray(customQA) || !customQA.length) return null;
    const hay = normalize([label, placeholder].filter(Boolean).join(' '));
    if (!hay) return null;
    const hayTokens = contentTokens(hay);

    let best = null;
    let bestScore = 0;
    for (let i = 0; i < customQA.length; i++) {
      const qa = customQA[i];
      if (!qa) continue;
      const q = normalize(qa.question);
      if (!q) continue;

      let score = 0;
      if (hay.includes(q) || q.includes(hay)) {
        score = 100 + Math.min(q.length, hay.length);
      } else {
        const qTokens = contentTokens(q);
        if (!qTokens.length || !hayTokens.length) continue;
        let overlap = 0;
        qTokens.forEach(function (t) {
          if (hayTokens.indexOf(t) !== -1) overlap += 1;
        });
        const ratio = overlap / Math.min(qTokens.length, hayTokens.length);
        // Needs most of the shorter phrase to line up, and a single shared
        // generic word is never enough.
        if (overlap >= 2 && ratio >= 0.6) score = Math.round(ratio * 50) + overlap;
        else if (overlap === 1 && qTokens.length === 1 && qTokens[0].length >= 6 && ratio >= 0.5) score = 25;
      }

      if (score > bestScore) {
        bestScore = score;
        best = qa.answer;
      }
    }
    return bestScore > 0 ? best : null;
  }


  function isBlank(v) {
    return v == null || String(v).trim() === '';
  }

  function missingKeys(profile, keys) {
    profile = profile || {};
    var out = [];
    (keys || []).forEach(function (k) {
      if (isBlank(profile[k])) out.push(k);
    });
    return out;
  }

  /** Lookup profile key / customAnswers / customQA — never invent. */
  function answerForLabel(profile, label) {
    profile = profile || {};
    var raw = label == null ? '' : String(label).trim();
    if (!raw) return { value: null, missing: true };

    if (Object.prototype.hasOwnProperty.call(profile, raw) && !isBlank(profile[raw])) {
      return { value: String(profile[raw]).trim(), missing: false, source: 'profile.' + raw };
    }

    var labLower = raw.toLowerCase();
    // A field-map hit whose top-level profile value is empty is not the end of
    // the search: source profiles store the same answer under customAnswers.
    // Remember the key for the "missing" report and keep looking.
    var blankFieldMapKey = null;
    for (var i = 0; i < FIELD_MAP.length; i++) {
      var entry = FIELD_MAP[i];
      if (!entry || !entry.key) continue;
      var hit = entry.key.toLowerCase() === labLower;
      var labels = entry.labels || [];
      var names = entry.names || [];
      for (var L = 0; !hit && L < labels.length; L++) {
        if (containsPhrase(labLower, String(labels[L]).toLowerCase())) hit = true;
      }
      for (var N = 0; !hit && N < names.length; N++) {
        if (labLower.indexOf(String(names[N]).toLowerCase()) !== -1) hit = true;
      }
      if (hit) {
        if (!isBlank(profile[entry.key])) {
          return { value: String(profile[entry.key]).trim(), missing: false, source: 'fieldMap.' + entry.key };
        }
        if (!blankFieldMapKey) blankFieldMapKey = entry.key;
      }
    }

    var cmap = profile.customAnswers;
    if (cmap && typeof cmap === 'object' && !Array.isArray(cmap)) {
      var keys = Object.keys(cmap);
      var best = null;
      var bestScore = 0;
      var bestKey = null;
      var nLab = raw.toLowerCase().replace(/\s+/g, ' ');
      var labTokens = contentTokens(nLab);
      for (var c = 0; c < keys.length; c++) {
        var k = keys[c];
        var nk = normalize(k);
        if (!nk) continue;
        var score = 0;
        if (nLab.indexOf(nk) !== -1 || nk.indexOf(nLab) !== -1) {
          score = 100 + Math.min(nk.length, nLab.length);
        } else {
          // customAnswers keys are camelCase ("noticePeriod"), so split them
          // before comparing against a human-readable page label.
          var keyTokens = contentTokens(String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
          if (!keyTokens.length || !labTokens.length) continue;
          var overlap = 0;
          for (var t = 0; t < keyTokens.length; t++) {
            if (labTokens.indexOf(keyTokens[t]) !== -1) overlap += 1;
          }
          var ratio = overlap / Math.min(keyTokens.length, labTokens.length);
          if (overlap >= 2 && ratio >= 0.6) score = Math.round(ratio * 50) + overlap;
          else if (overlap === 1 && keyTokens.length === 1 && keyTokens[0].length >= 6) score = 25;
        }
        if (score > bestScore) {
          bestScore = score;
          best = cmap[k];
          bestKey = k;
        }
      }
      if (bestKey != null && !isBlank(best)) {
        return { value: String(best).trim(), missing: false, source: 'customAnswers.' + bestKey };
      }
      if (bestKey != null && !blankFieldMapKey) blankFieldMapKey = bestKey;
    }

    var qa = matchCustomQA(profile.customQA, raw, '');
    if (!isBlank(qa)) return { value: String(qa).trim(), missing: false, source: 'customQA' };

    if (blankFieldMapKey) return { value: null, missing: true, key: blankFieldMapKey };
    return { value: null, missing: true };
  }

  function requireOrPause(profile, keyOrLabel) {
    var key = keyOrLabel == null ? '' : String(keyOrLabel).trim();
    if (!key) {
      return {
        value: null,
        missing: true,
        needsHuman: true,
        pauseReason: 'missing_profile_field',
        missingProfileFields: ['(unknown field)'],
        error: 'Missing profile field — fill in Options or on the page, then Resume'
      };
    }
    if (Object.prototype.hasOwnProperty.call(profile || {}, key) && !isBlank(profile[key])) {
      return { value: String(profile[key]).trim(), missing: false };
    }
    var looked = answerForLabel(profile, key);
    if (!looked.missing && !isBlank(looked.value)) {
      return { value: looked.value, missing: false, source: looked.source };
    }
    var label = looked.key || key;
    return {
      value: null,
      missing: true,
      needsHuman: true,
      pauseReason: 'missing_profile_field',
      missingProfileFields: [label],
      error:
        'Missing profile field: ' + label + ' — fill in Options or on the page, then Resume'
    };
  }

    /* Label synonyms for actions/files also live in FillApplySynonyms (Resume≈CV, Apply≈Apply Now). */
  global.FillApplyFieldMap = {
    FIELD_MAP,
    normalize,
    contentTokens,
    scoreMatch,
    bestKeyForField,
    matchCustomQA,
    isBlank: isBlank,
    missingKeys: missingKeys,
    answerForLabel: answerForLabel,
    requireOrPause: requireOrPause
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
