# @cognisivelabs/openapi-to-express

Generate Express routes, controller interfaces, and TypeScript types from an OpenAPI spec. Design-first API development — define your contract first, the compiler enforces it.

## Install

```bash
npm install -D @cognisivelabs/openapi-to-express
```

## Quick Start

```bash
npx openapi-to-express -i openapi.json -o src
```

This reads your OpenAPI spec and generates files grouped by **tag**:

```
src/
├── types/
│   ├── users.types.ts                  # TypeScript interfaces and enums
│   └── index.ts                        # Barrel re-exports
├── controllers/
│   ├── users.controller.interface.ts   # UsersController interface
│   └── index.ts
└── routes/
    ├── users.routes.ts                 # Complete Express router
    └── index.ts
```

Each tag in your spec gets its own types, controller interface, and routes file. Schemas shared across tags go to `common.types.ts` automatically.

## Step-by-Step Usage

### 1. Write your OpenAPI spec

```yaml
# openapi.yaml
openapi: "3.0.3"
info:
  title: User API
  version: "1.0.0"
paths:
  /users/{id}:
    get:
      operationId: getUserById
      tags: [Users]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: User found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
  /users:
    post:
      operationId: createUser
      tags: [Users]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUserRequest"
      responses:
        "201":
          description: User created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
components:
  schemas:
    User:
      type: object
      required: [id, name, email]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
          format: email
    CreateUserRequest:
      type: object
      required: [name, email]
      properties:
        name:
          type: string
        email:
          type: string
```

### 2. Generate code

```bash
npx openapi-to-express -i openapi.yaml -o src
```

### 3. See what was generated

**Types** (`src/types/users.types.ts`):

```typescript
export interface User {
  /** @format uuid */
  id: string;
  name: string;
  /** @format email */
  email: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
}
```

**Controller interface** (`src/controllers/users.controller.interface.ts`):

```typescript
import type { Request, Response } from "express";

export interface UsersController {
  getUserById(req: Request, res: Response): Promise<void>;
  createUser(req: Request, res: Response): Promise<void>;
}
```

**Routes** (`src/routes/users.routes.ts`) — lean, one line per endpoint:

```typescript
import { Router } from "express";
import type { UsersController } from "../controllers/users.controller.interface";

export function createUsersRouter(controller: UsersController, middleware?: any[]): Router {
  const router = Router();

  if (middleware) {
    middleware.forEach((mw) => router.use(mw));
  }

  router.get("/users/:id", (req, res) => controller.getUserById(req, res));
  router.post("/users", (req, res) => controller.createUser(req, res));

  return router;
}
```

### 4. Implement the controller

The controller owns the HTTP layer — param extraction, response formatting, error handling:

```typescript
// src/controllers/users.controller.ts
import type { Request, Response } from "express";
import type { UsersController } from "./users.controller.interface";
import type { User } from "../types/users.types";

export class UsersControllerImpl implements UsersController {
  constructor(private readonly userService: UserService) {}

  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id;
      const user = await this.userService.findById(id);
      res.json(user);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  }

  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const user = await this.userService.create(req.body);
      res.status(201).json(user);
    } catch (err: any) {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  }

  async createUser(request: CreateUserRequest): Promise<User> {
  }
}
```

### 5. Wire it in your server

```typescript
// src/server.ts
import express from "express";
import { createUsersRouter } from "./routes/users.routes";
import { UsersControllerImpl } from "./controllers/users.controller";
import { UserServiceImpl } from "./services/user.service";

const app = express();
app.use(express.json());

const userService = new UserServiceImpl();
const controller = new UsersControllerImpl(userService);
app.use("/api/v1", createUsersRouter(controller));

app.listen(3000);
```

### 6. When the spec changes

```bash
# Architect adds a new endpoint to openapi.yaml
npx openapi-to-express -i openapi.yaml -o src

# TypeScript now fails — UsersControllerImpl doesn't implement the new method
# Developer adds the implementation, tsc passes, contract enforced
```

## CLI Options

```
Usage:
  openapi-to-express --input <spec> --output <dir> [options]
  openapi-to-express                                          (reads from .openapi-to-expressrc.json)

Required (unless provided in config file):
  -i, --input <value>          OpenAPI spec — file path (.json/.yaml/.yml), URL, or string
  -o, --output <value>         Output directory (e.g. "src")

Optional:
  --types-dir <name>           Folder name for types (default: "types")
  --controllers-dir <name>     Folder name for controllers (default: "controllers")
  --routes-dir <name>          Folder name for routes (default: "routes")
  --dry-run                    Show what would be generated without writing files
  -w, --watch                  Watch spec file and regenerate on changes
  -v, --version                Output version number
  -h, --help                   Show help

Examples:
  npx openapi-to-express -i openapi.json -o src
  npx openapi-to-express -i openapi.yaml -o src
  npx openapi-to-express -i https://petstore3.swagger.io/api/v3/openapi.json -o src
  npx openapi-to-express -i openapi.json -o src --types-dir models --controllers-dir interfaces
  npx openapi-to-express -i openapi.json -o src --dry-run
  npx openapi-to-express -i openapi.json -o src --watch
```

## Config File

Create `.openapi-to-expressrc.json` in your project root to avoid repeating CLI flags:

```json
{
  "input": "openapi.yaml",
  "output": "src",
  "types-dir": "types",
  "controllers-dir": "controllers",
  "routes-dir": "routes"
}
```

Then just run:

```bash
npx openapi-to-express
```

CLI flags override config file values.

## Programmatic API

```typescript
import { generate } from "@cognisivelabs/openapi-to-express";

await generate({
  input: "openapi.json",
  output: "src",
  dryRun: false,
  dirs: {
    types: "models",
    controllers: "interfaces",
    routes: "api",
  },
});
```

## Supported OpenAPI Features

### Schemas

| Feature | Generated TypeScript |
|---|---|
| `type: object` with `properties` | `export interface Name { ... }` |
| `type: string / number / integer / boolean` | `string`, `number`, `boolean` |
| `type: array` | `Type[]` |
| `$ref` | Resolved type name |
| `enum` (string) | Named `const` object + type alias |
| `enum` (integer) | Named `const` object with number values |
| `required` / optional | Required fields, `?` for optional |
| `nullable: true` | `Type \| null` |
| `allOf` with `$ref` + properties | `interface Child extends Base { ... }` |
| `allOf` (pure intersection) | `type AB = A & B` |
| `oneOf` / `anyOf` | `type Either = A \| B` |
| `discriminator` | `@discriminator` JSDoc tag |
| Inline nested objects | `{ field: type; ... }` |
| `additionalProperties` | `Record<string, Type>` |
| `format` (date-time, uuid, email, etc.) | `@format` JSDoc annotation |
| `default` values | `@default` JSDoc annotation |
| `readOnly` / `writeOnly` | `@readonly` / `@writeOnly` JSDoc |
| `deprecated` (on schema or property) | `@deprecated` JSDoc |
| `description` | JSDoc comment |

### Operations

| Feature | Generated code |
|---|---|
| Path parameters (`/users/{id}`) | Route uses Express `:id` format |
| Query parameters | Parsed from spec for types generation |
| Header parameters | Parsed from spec for types generation |
| `$ref` parameters (`#/components/parameters/...`) | Resolved from components |
| Request body (`application/json`) | Schema used for types generation |
| Inline request/response schemas | Auto-named `{OperationId}Request` / `{OperationId}Response` |
| Response `200`, `201`, `202` | Response type generated |
| Response `204` No Content | Parsed as `void` response |
| Error responses (`4xx`, `5xx`) | Error types generated in types file |
| `summary` / `description` | JSDoc on controller methods |
| `deprecated` operations | `@deprecated` JSDoc |
| Tags | One file set per tag |

### Code Organization

| Feature | How it works |
|---|---|
| Shared schemas | Types used by 2+ tags go to `common.types.ts` |
| Barrel files | `index.ts` per folder for clean imports |
| Overwrite protection | Won't overwrite files you've manually modified |
| Configurable directories | `--types-dir`, `--controllers-dir`, `--routes-dir` |

## What's NOT Generated

The generator only produces code that can be derived from the OpenAPI spec. The following are your responsibility:

- **Authentication / authorization** — middleware, token validation, user extraction
- **Service layer** — business logic, database access
- **Controller implementation** — the class that implements the generated interface, handles param extraction, response formatting, error handling
- **Validation** — consider [express-openapi-validator](https://www.npmjs.com/package/express-openapi-validator) for request validation from the same spec

## Requirements

- Node.js 20+
- Express 4.x or 5.x in your project
- TypeScript 5.x

## License

MIT
