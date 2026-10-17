// Words that name a job: a headline part with one is someone's role (refine.ts),
// and in a name field they're a tagline, not part of the name (patterns.ts).
// No imports, so the email guesser can use it without the search code.

export const JOB_WORDS = new Set(
  `accountant administrator adviser advisor agent analyst architect artist assistant associate attorney author broker buyer ceo cfo chair
  chairman chairperson chairwoman chief cio cmo coach cofounder consultant controller coo coordinator copywriter counsel creator cro cto dean
  designer developer director editor engineer entrepreneur evp executive founder head instructor investor lawyer lead leader manager marketer
  md member mentor officer operator owner partner planner president principal producer professor proprietor publisher recruiter rep
  representative researcher scientist secretary speaker specialist strategist superintendent supervisor svp teacher technician trainer
  treasurer trustee vp writer`.split(/\s+/),
)
