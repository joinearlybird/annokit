# annokit

This is the `npx annokit` command for
[AnnoKit](https://github.com/joinearlybird/annokit). The package itself is
[`@joinearlybird/annokit`](https://www.npmjs.com/package/@joinearlybird/annokit):
install that one in your app, not this.

```bash
npx expo install @joinearlybird/annokit   # or: npm install @joinearlybird/annokit
npx annokit server
```

Inside an app with `@joinearlybird/annokit` installed, `npx annokit` runs
that install's own command, and this package is never downloaded. Anywhere
else, this package runs the `@joinearlybird/annokit` that resolves from the
current directory, and if there is none it says how to install it. It has
no dependencies and runs nothing else.

MIT © Feliz Labs
