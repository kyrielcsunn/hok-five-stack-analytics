import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const heroesPath = fileURLToPath(new URL("../../data/reference/heroes.json", import.meta.url));

let cachedReference = null;

function normalizeTerm(value) {
  return value.trim().toLowerCase();
}

export function loadHeroReference() {
  if (!cachedReference) {
    cachedReference = JSON.parse(readFileSync(heroesPath, "utf8"));
  }

  return cachedReference;
}

export function listHeroes() {
  return loadHeroReference().heroes;
}

export function findHeroById(heroId) {
  return listHeroes().find((hero) => hero.id === heroId) ?? null;
}

export function searchHeroes(term) {
  const normalizedTerm = normalizeTerm(term);

  if (!normalizedTerm) {
    return listHeroes();
  }

  return listHeroes().filter((hero) => {
    const names = [hero.name, hero.id, ...(hero.aliases ?? [])];
    return names.some((name) => normalizeTerm(name).includes(normalizedTerm));
  });
}
