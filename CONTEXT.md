# mdwiki

Language settled during the grill for a Markdown knowledge base that works directly
in an existing folder, alongside Obsidian or another editor.

## Language

**Vault**:
The selected existing Markdown folder and its eligible nested notes.
_Avoid_: Database, imported library

**Note**:
A Markdown file in the vault, identified by its exact vault-relative path.
_Avoid_: Record, page ID

**Index**:
A rebuildable cache derived from vault files; never the source of truth.
_Avoid_: Master database

**Adoption**:
Adding the managed frontmatter schema on a note's first mdwiki write.
_Avoid_: Import, migration of the vault

**Content version**:
A digest of the exact note bytes read, used to reject stale replacement requests.
_Avoid_: Revision number, Git version

**Backlink**:
A resolved link from another note to the selected note, including note embeds.
_Avoid_: Unlinked mention
