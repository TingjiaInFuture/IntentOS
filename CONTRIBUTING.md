# Contributing to IntentOS

Thank you for your interest in contributing to IntentOS! This document provides guidelines and information for contributors.

## Code of Conduct

Please be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

- Check if the bug has already been reported in Issues
- Include a clear title and description
- Provide steps to reproduce
- Include code samples if applicable
- Note your environment (OS, Node version, etc.)

### Suggesting Features

- Check if the feature has been suggested
- Clearly describe the feature and its benefits
- Provide use cases and examples
- Consider implementation complexity

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write or update tests
5. Ensure tests pass (`npm test`)
6. Ensure code is formatted (`npm run format`)
7. Ensure linting passes (`npm run lint`)
8. Commit your changes (`git commit -m 'Add amazing feature'`)
9. Push to your branch (`git push origin feature/amazing-feature`)
10. Open a Pull Request

## Development Setup

```bash
# Clone the repository
git clone https://github.com/TingjiaInFuture/IntentOS.git
cd IntentOS

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration

# Build
npm run build

# Run tests
npm test

# Run demo
npm run dev
```

## Code Style

- Use TypeScript
- Follow existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Write JSDoc comments for public APIs

## Testing

- Write tests for new features
- Ensure existing tests pass
- Aim for high code coverage
- Test edge cases

## Documentation

- Update README.md if needed
- Add JSDoc comments to new code
- Update examples if applicable
- Document breaking changes

## Commit Messages

Use clear and descriptive commit messages:

```
feat: Add new agent type for procurement
fix: Resolve workflow state persistence issue
docs: Update API documentation
test: Add tests for intent extraction
refactor: Simplify approval system logic
```

## Questions?

Open an issue for questions or discussions.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
