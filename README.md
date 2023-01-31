# Sitelink-API Mirror

Static mirror for NatureScot's Sitelink API

Automation and version control inspired by [Simon Willison's work on git scraping](https://simonwillison.net/2020/Oct/9/git-scraping/).

## Debug with VSCode

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Launch via npm",
            "type": "node",
            "runtimeVersion": "18",
            "request": "launch",
            "cwd": "${workspaceFolder}",
            "runtimeExecutable": "npm",
            "runtimeArgs": ["run-script", "start"]
          }
    ]
}
```

## License

Unless otherwise stated, all data is made available under the [Open Government Licence, Version 3](LICENSE.md) and the codebase is released under the [MIT License](LICENSE-MIT.txt).
