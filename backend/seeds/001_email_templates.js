const { DEFAULT_TEMPLATES } = require("../shop/email/templates")

exports.seed = async function (knex) {
  for (const [type, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await knex("email_templates").where({ type }).first()
    // Only insert what is missing: never overwrite the seller's edits.
    if (!existing) {
      await knex("email_templates").insert({ type, subject: tpl.subject, body_html: tpl.body_html })
    }
  }
}
