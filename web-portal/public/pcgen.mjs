// PCGen export readers shared in behaviour with the local Foundry importer. No imported markup is rendered.
export function parseCharacterExport(text, fileName) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (/\.pcg$/i.test(fileName) || /^PCGVERSION:/m.test(trimmed)) return parsePcg(trimmed);
  if (!trimmed) {
    throw new Error(`${fileName} is empty. Use the non-empty PCGen export, from an XML export.`);
  }

  if (trimmed.startsWith("{")) {
    return normalizeJsonCharacter(JSON.parse(trimmed), fileName);
  }

  if (trimmed.startsWith("<")) {
    return normalizeXmlCharacter(trimmed, fileName);
  }

  return normalizeTextCharacter(trimmed, fileName);
}

function normalizeJsonCharacter(data, fileName) {
  const source = data.character ?? data.pcgen ?? data;
  return {
    ...source,
    name: readFirst(source, ["name", "characterName", "displayName"]) ?? nameFromFile(fileName),
    race: readFirst(source, ["race", "ancestry", "species"]),
    className: readFirst(source, ["class", "className", "classes"]),
    level: toNumber(readFirst(source, ["level", "totalLevel", "characterLevel"])),
    hp: toNumber(readFirst(source, ["hp", "hitPoints", "maxHp", "maxHP"])),
    abilities: normalizeAbilities(source.abilities ?? source.stats ?? source.attributes ?? source)
  };
}

function normalizeXmlCharacter(text, fileName) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("XML entity declarations are not supported.");
  const document = new DOMParser().parseFromString(text, "text/xml");
  if(document.querySelector("parsererror")) throw new Error("This XML is malformed. Export it again from PCGen.");
  const profilerNodes = readProfilerNodes(document);
  const openRpgNodes = readOpenRpgNodes(document);
  const hasProfilerData = Object.keys(profilerNodes).length > 0;

  if (!hasProfilerData && openRpgNodes) {
    return normalizeOpenRpgCharacter(openRpgNodes, fileName);
  }

  if (!hasProfilerData) {
    throw new Error(`${fileName} is XML, but it does not contain a supported PCGen export format.`);
  }

  const get = (...selectors) => {
    for (const selector of selectors) {
      const nodeValue = readFirst(profilerNodes, [selector]);
      if (nodeValue) return nodeValue;
    }

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node?.textContent?.trim()) return node.textContent.trim();
    }
    return null;
  };

  return {
    name: get("Name", "cname", "character > name", "name", "character_name", "charactername") ?? nameFromFile(fileName),
    player: get("Player", "player"),
    race: get("Race", "race", "ancestry", "species"),
    className: get("Class", "class", "classes", "class_name", "classname"),
    level: toNumber(get("Level", "level", "total_level", "characterlevel")),
    hp: toNumber(get("HP", "hp", "hitpoints", "hit_points", "maxhp")),
    ac: toNumber(get("AC", "ac")),
    speed: get("Speed", "speed"),
    alignment: get("Alignment", "alignment"),
    size: get("Size", "size"),
    gender: get("Gender", "gender"),
    notes: get("Notes", "notes"),
    sourceFormat: "pcgen-3eprofiler",
    raw: profilerNodes,
    feats: readSequentialValues(profilerNodes, "Feat"),
    languages: readSequentialValues(profilerNodes, "Lang"),
    skills: readNumberedEntries(profilerNodes, "Skill", ["Ab", "Mod", "Rank", "MiscMod"]),
    abilities: normalizeAbilities({
      str: get("Str", "str", "strength"),
      dex: get("Dex", "dex", "dexterity"),
      con: get("Con", "con", "constitution"),
      int: get("Int", "int", "intelligence"),
      wis: get("Wis", "wis", "wisdom"),
      cha: get("Cha", "cha", "charisma")
    })
  };
}

function normalizeOpenRpgCharacter(data, fileName) {
  const raw = {
    Name: data.text.Name,
    Race: data.text.Race,
    Class: data.text.Classes,
    Speed: data.text.Speed,
    Alignment: data.text.Alignment,
    HP: data.hp,
    AC: data.ac?.normal,
    TouchAC: data.ac?.touch,
    FFAC: data.ac?.flatFooted,
    BaseAttack: data.text["Basic Attack Bonus"],
    Equipment: data.text.Equipment,
    Notes: [data.text.Notes, data.text["Special Abilities"], data.spells].filter(Boolean).join("\n\n"),
    SourceTemplate: "PCGen OpenRPG"
  };

  for (const [ability, values] of Object.entries(data.abilities)) {
    const key = ability.toUpperCase();
    raw[toTitleCase(key)] = values.value;
    raw[`${toTitleCase(key)}Mod`] = values.mod;
  }

  for (const [save, value] of Object.entries(data.saves)) {
    raw[save] = value;
  }

  data.skills.forEach((skill, index) => {
    const number = String(index + 1).padStart(2, "0");
    raw[`Skill${number}`] = skill.name;
    raw[`Skill${number}Mod`] = skill.mod;
    raw[`Skill${number}Rank`] = skill.rank;
    raw[`Skill${number}MiscMod`] = skill.misc;
  });

  data.feats.forEach((feat, index) => {
    raw[`Feat${String(index + 1).padStart(2, "0")}`] = feat;
  });

  data.languages.forEach((language, index) => {
    raw[`Lang${index + 1}`] = language;
  });

  return {
    name: raw.Name ?? nameFromFile(fileName),
    race: raw.Race,
    className: raw.Class,
    level: parsePcgenClasses(raw.Class).reduce((sum,c)=>sum+(c.level||0),0)||undefined,
    hp: toNumber(raw.HP),
    ac: toNumber(raw.AC),
    speed: raw.Speed,
    alignment: raw.Alignment,
    notes: raw.Notes,
    sourceFormat: "pcgen-openrpg",
    raw,
    feats: data.feats,
    languages: data.languages,
    equipment: parseOpenRpgEquipment(data.text.Equipment),
    weapons: data.weapons,
    skills: data.skills.map(skill => ({
      name: skill.name,
      Mod: skill.mod,
      Rank: skill.rank,
      MiscMod: skill.misc
    })),
    abilities: normalizeAbilities(raw)
  };
}

function normalizeTextCharacter(text, fileName) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:=]+)\s*[:=]\s*(.+?)\s*$/);
    if (!match) continue;
    values[match[1].trim().toLowerCase().replace(/\s+/g, "")] = match[2].trim();
  }

  return {
    name: values.name ?? values.charactername ?? nameFromFile(fileName),
    race: values.race ?? values.ancestry ?? values.species,
    className: values.class ?? values.classes ?? values.classname,
    level: toNumber(values.level ?? values.totallevel),
    hp: toNumber(values.hp ?? values.hitpoints ?? values.maxhp),
    abilities: normalizeAbilities(values)
  };
}

function parsePcgenClass(className) {
  return parsePcgenClasses(className)[0] ?? null;
}

function parsePcgenClasses(className) {
  if (!className) return [];
  const text = String(className).trim();
  const matches = [...text.matchAll(/([A-Za-z][A-Za-z\s'’.-]*?)(\d+)(?=\s+[A-Za-z]|$)/g)];
  if (!matches.length) return [{ name: text, level: undefined }];

  return matches.map(match => ({
    name: match[1].trim(),
    level: toNumber(match[2])
  }));
}

function readProfilerNodes(document) {
  const values = {};
  const nodes = Array.from(document.getElementsByTagName("*"))
    .filter(node => node.localName === "node" && node.getAttribute("name"));

  for (const node of nodes) {
    values[node.getAttribute("name")] = node.textContent?.trim() ?? "";
  }

  return values;
}

function readOpenRpgNodes(document) {
  const handlers = Array.from(document.getElementsByTagName("*"))
    .filter(node => node.localName === "nodehandler" && node.getAttribute("name"));

  if (!handlers.length) return null;

  const text = {};
  for (const handler of handlers) {
    const name = handler.getAttribute("name");
    const textNode = directChild(handler, "text");
    if (textNode) text[name] = textNode.textContent?.trim() ?? "";
  }

  const abilities = {};
  for (const row of gridRows(findHandler(handlers, "Abilities"))) {
    const label = row[0]?.toLowerCase();
    if (!["str", "dex", "con", "int", "wis", "cha"].includes(label)) continue;
    abilities[label] = { value: row[1], mod: row[2] };
  }

  const skills = gridRows(findHandler(handlers, "Skills"))
    .filter(row => row.length >= 5 && row[0] !== "Skill")
    .map(row => ({
      name: row[0],
      mod: row[1],
      rank: row[2],
      stat: row[3],
      misc: row[4]
    }));

  const saves = {};
  const savingThrowHandler = findHandler(handlers, "Saving Throws");
  for (const option of Array.from(savingThrowHandler?.getElementsByTagName("option") ?? [])) {
    const label = option.textContent?.trim() ?? "";
    const match = label.match(/^(Fortitude|Reflex|Will)\s+\[([+-]?\d+)/i);
    if (!match) continue;
    saves[match[1] === "Fortitude" ? "Fort" : match[1]] = match[2];
  }

  const hpMatch = handlers
    .map(handler => handler.getAttribute("name"))
    .find(name => name?.startsWith("Current HP"))
    ?.match(/out of\s+(\d+)/i);

  return {
    text,
    abilities,
    skills,
    saves,
    hp: hpMatch?.[1],
    ac: parseOpenRpgAc(text["AC: Total / Touch / Flat Footed"]),
    feats: splitLines(text.Feats),
    languages: String(text.Languages ?? "").split(",").map(part => part.trim()).filter(Boolean),
    weapons: readOpenRpgWeapons(handlers),
    spells: readOpenRpgSpells(handlers)
  };
}

function findHandler(handlers, name) {
  return handlers.find(handler => handler.getAttribute("name") === name);
}

function directChild(node, localName) {
  return Array.from(node.children ?? []).find(child => child.localName === localName);
}

function gridRows(handler) {
  const grid = directChild(handler, "grid");
  if (!grid) return [];

  return Array.from(grid.getElementsByTagName("row")).map(row =>
    Array.from(row.getElementsByTagName("cell")).map(cell => cell.textContent?.trim() ?? "")
  );
}

function parseOpenRpgAc(value) {
  const match = String(value ?? "").match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (!match) return {};
  return {
    normal: match[1],
    touch: match[2],
    flatFooted: match[3]
  };
}

function readOpenRpgSpells(handlers) {
  return handlers
    .filter(handler => /^Level \d+$/i.test(handler.getAttribute("name") ?? ""))
    .map(handler => `${handler.getAttribute("name")}\n${directChild(handler, "text")?.textContent?.trim() ?? ""}`)
    .filter(text => text.trim())
    .join("\n\n");
}

function parseOpenRpgEquipment(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const ignored = /^(name\s+qty\s+lbs|total weight|current load|encumbrance|light:|medium:|heavy:|lift|push|drag)/i;
  const items = [];

  for (const line of lines) {
    if (ignored.test(line)) continue;

    const match = line.match(/^(?<name>.+?)\s{2,}(?<quantity>\d+(?:\.\d+)?)?\s*(?<weight>\d+(?:\.\d+)?)?$/);
    const fallbackMatch = line.match(/^(?<quantity>\d+)x?\s+(?<name>.+)$/i);

    const name = (match?.groups?.name ?? fallbackMatch?.groups?.name ?? line).trim();
    if (!name || /^[-\s]+$/.test(name)) continue;

    items.push({
      name,
      quantity: toNumber(match?.groups?.quantity ?? fallbackMatch?.groups?.quantity) ?? 1,
      weight: toNumber(match?.groups?.weight) ?? 0,
      original: line
    });
  }

  return items;
}

function readOpenRpgWeapons(handlers) {
  const weaponsRoot = findHandler(handlers, "Weapons");
  if (!weaponsRoot) return [];

  const weapons = [];
  const weaponHandlers = Array.from(weaponsRoot.children ?? [])
    .filter(node => node.localName === "nodehandler" && node.getAttribute("class") === "tabber_handler");

  for (const handler of weaponHandlers) {
    const label = handler.getAttribute("name")?.trim();
    if (!label || /^weapon summary$/i.test(label)) continue;

    const optionText = Array.from(handler.getElementsByTagName("option"))
      .map(option => option.textContent?.trim() ?? "")
      .find(Boolean);

    const textText = Array.from(handler.getElementsByTagName("text"))
      .map(text => text.textContent?.trim() ?? "")
      .find(Boolean);

    const original = optionText || textText || label;
    weapons.push({
      name: cleanOpenRpgWeaponName(label),
      attackBonus: parseOpenRpgWeaponAttack(original),
      damage: parseOpenRpgWeaponDamage(original),
      original
    });
  }

  return dedupeByName(weapons);
}

function cleanOpenRpgWeaponName(value) {
  return String(value ?? "")
    .replace(/\s+\d+\/\d+\s*:\s*$/i, "")
    .replace(/\s+Secondary\s*:\s*$/i, "")
    .trim();
}

function parseOpenRpgWeaponAttack(value) {
  const match = String(value ?? "").match(/\[(?:1d20)?([+-]\d+)/i);
  return match?.[1] ?? "";
}

function parseOpenRpgWeaponDamage(value) {
  const match = String(value ?? "").match(/Damage\s+\[([^\]@]+)/i);
  return match?.[1]?.trim() ?? "";
}

function dedupeByName(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function readSequentialValues(raw, prefix) {
  return Object.entries(raw)
    .filter(([key, value]) => key.match(new RegExp(`^${prefix}\\d+$`)) && value)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, value]) => value);
}

function readNumberedEntries(raw, prefix, suffixes) {
  return Object.entries(raw)
    .filter(([key, value]) => key.match(new RegExp(`^${prefix}\\d+$`)) && value)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([key, name]) => {
      const index = key.slice(prefix.length);
      const entry = { name };

      for (const suffix of suffixes) {
        entry[suffix] = raw[`${prefix}${index}${suffix}`];
      }

      return entry;
    });
}

function normalizeAbilities(source) {
  const aliases = {
    str: ["str", "strength"],
    dex: ["dex", "dexterity"],
    con: ["con", "constitution"],
    int: ["int", "intelligence"],
    wis: ["wis", "wisdom"],
    cha: ["cha", "charisma"]
  };

  const abilities = {};
  for (const [key, names] of Object.entries(aliases)) {
    const value = toNumber(readFirst(source, names));
    if (value !== undefined) abilities[key] = value;
  }
  return abilities;
}

function readFirst(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];

    const foundKey = Object.keys(source).find(candidate => candidate.toLowerCase() === key.toLowerCase());
    if (foundKey && source[foundKey] !== undefined && source[foundKey] !== null && source[foundKey] !== "") {
      return source[foundKey];
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const match = String(value).match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const number = Number.parseFloat(match[0]);
  return Number.isFinite(number) ? number : undefined;
}

function toTitleCase(value) {
  const text = String(value ?? "").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nameFromFile(fileName) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

// PCG saves contain build choices, not PCGen's final calculated statblock.
export function parsePcg(input){
  if(!/^PCGVERSION:2(?:\.0)?\s*$/m.test(input))throw new Error('Only PCGen version 2 saved-character files are supported.');
  const decode=s=>String(s??'').replace(/&(amp|colon|pipe|lbracket|rbracket|nl|cr);/g,(_,k)=>({amp:'&',colon:':',pipe:'|',lbracket:'[',rbracket:']',nl:'\n',cr:'\r'}[k]));
  const tokens=line=>{let depth=0,start=0,out=[];for(let i=0;i<line.length;i++){if(line[i]==='[')depth++;if(line[i]===']')depth--;if(line[i]==='|'&&depth===0){out.push(line.slice(start,i));start=i+1;}}out.push(line.slice(start));return out.map(t=>{const i=t.indexOf(':');return [t.slice(0,i),decode(t.slice(i+1))];});};
  const lines=input.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('#')).map(tokens),first=k=>lines.flat().find(([key])=>key===k)?.[1],rows=k=>lines.filter(l=>l[0]?.[0]===k),get=(l,k)=>l.find(([key])=>key===k)?.[1];
  const name=first('CHARACTERNAME');if(!name)throw new Error('The PCG file does not contain a character name.');
  const classes=rows('CLASS').map(l=>({name:l[0][1],level:toNumber(get(l,'LEVEL'))}));
  const abilities={};for(const l of rows('STAT')){const key=l[0][1].split('=')[0].toLowerCase();if(['str','dex','con','int','wis','cha'].includes(key))abilities[key]=toNumber(get(l,'SCORE')??l[0][1].split('=')[1]);}
  const skills=rows('SKILL').map(l=>({name:l[0][1],Rank:toNumber(get(l,'RANK'))??[...String(get(l,'CLASSBOUGHT')||'').matchAll(/RANKS:([\d.]+)/g)].reduce((n,m)=>n+Number(m[1]),0)}));
  return {name,race:first('RACE'),className:classes.map(c=>c.name+' '+(c.level??'?')).join(' / '),level:classes.reduce((n,c)=>n+(c.level||0),0)||undefined,alignment:first('ALIGNMENT')||first('ALIGN'),gender:first('GENDER'),abilities,skills,feats:[...rows('FEAT').map(l=>l[0][1]),...rows('ABILITY').map(l=>get(l,'KEY')||get(l,'ABILITY')||l[0][1])],languages:lines.flat().filter(([k])=>k==='LANGUAGE').map(([,v])=>v),equipment:rows('EQUIPNAME').map(l=>({name:l[0][1],quantity:toNumber(get(l,'QUANTITY')),weight:toNumber(get(l,'WT'))})),spells:rows('SPELLNAME').map(l=>`${l[0][1]} · level ${get(l,'SPELLLEVEL')??'?'} · ${get(l,'SPELLBOOK')||get(l,'SPELL_BOOK')||'Known'}`).join('\n'),sourceFormat:'pcgen-pcg',warnings:['PCG ability scores are saved build scores, not final adjusted totals.','PCG files need PCGen rule datasets to calculate final HP, AC, saves, attack and skill totals. Import an XML export for calculated values, or enter verified totals in Sheet totals.'],raw:{}};
}
