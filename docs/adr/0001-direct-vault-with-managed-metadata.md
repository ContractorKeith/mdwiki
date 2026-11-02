# Direct vault access with metadata adoption on write

mdwiki works directly in an existing vault to complement its editor, but adopts
`title`, `created`, `updated`, and `tags` on the first mdwiki write to each note.
Reads/indexing never migrate files, and writes preserve custom YAML and comments;
this deliberately trades a simpler raw-text writer for consistent metadata
without requiring a bulk vault migration.
