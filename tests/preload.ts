import { resolve, join } from "path";

// Use a separate data directory for tests so that running tests
// never touches the user's dev data in data/.
process.env.DATA_DIR = resolve(join(import.meta.dir, "..", "data-test"));
