Apple Pay domain verification (Stripe)

1. Stripe Dashboard → Settings → Payment methods → Apple Pay → add your domain → download the association file.

2. Save it in this folder with this exact name (no file extension):
   apple-developer-merchantid-domain-association

3. Commit that file to git and deploy. Clean clones must include it or GET
   /.well-known/apple-developer-merchantid-domain-association
   returns 404 and Apple verification fails.

4. File must have NO extension and NO trailing newline. VS Code / Prettier often append
   a final newline on save; Apple's crawler then rejects the file even if the Dashboard
   looks fine. After saving, verify the last byte is "}" (end of JSON), not 0a (LF):

     xxd client/public/.well-known/apple-developer-merchantid-domain-association | tail -2

   If the last line shows 0a, strip the trailing newline (e.g. save without final newline
   in an editor that supports it, or trim in Git Bash: truncate to drop the last byte).

The file content is merchant-specific; it cannot be generated in this repo.
