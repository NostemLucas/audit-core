/** Commits convencionales (feat, fix, refactor, style, docs, test, chore…). Los cuerpos largos y explicativos son bienvenidos. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'subject-case': [0],
  },
}
