// A deliberately curated catalogue, not an exhaustive reproduction of a setting book.
// Month/week names: Paizo's original setting article. Holiday dates/tags: the
// cited PathfinderWiki articles, a secondary index citing Paizo print sources.
// Summaries are original and intentionally brief; read linked sources for detail.
export const GOLARION_MONTHS=['Abadius','Calistril','Pharast','Gozran','Desnus','Sarenith','Erastus','Arodus','Rova','Lamashan','Neth','Kuthona'];
export const GOLARION_WEEKDAYS=['Moonday','Toilday','Wealday','Oathday','Fireday','Starday','Sunday'];
export const GOLARION_MONTH_LENGTHS=[31,28,31,30,31,30,31,31,30,31,30,31];
export const GOLARION={
 id:'golarion',name:'Golarion (Absalom Reckoning)',era:'AR',
 months:GOLARION_MONTHS.map((name,i)=>({name,days:GOLARION_MONTH_LENGTHS[i]})),
 weekdays:[...GOLARION_WEEKDAYS],hoursPerDay:24,minutesPerHour:60,secondsPerMinute:60,
 leap:{interval:8,offset:0,month:2,days:1},
 sources:['https://paizo.com/blog/time-on-golarion-mdash-days-of-the-week','https://pathfinderwiki.com/wiki/Absalom_Reckoning','https://pathfinderwiki.com/wiki/Holidays_and_festivals'],
 sourceNote:'PF1 preset uses the eight-year leap cycle described in the holiday index. Newer setting sources use four years. The GM can change the interval to match the campaign and Foundry calendar. Early setting articles also used different month lengths.',
};
const index='https://pathfinderwiki.com/wiki/Holidays_and_festivals';
const fixed=(id,name,month,day,tags,source=index)=>({id,name,month,day,tags,source,sourceKind:source.startsWith('https://paizo.com/')?'primary':'secondary',recurrence:'annual'});
const seasonal=(id,name,month,dateLabel,tags,source=index)=>({id,name,month,day:null,dateLabel,tags,source,sourceKind:'secondary',recurrence:'seasonal',needsDate:true});
export const GOLARION_HOLIDAYS=[
 fixed('new-year','New Year',1,1,['general']),
 fixed('foundation','Foundation Day',1,1,['region:Absalom','deity:Milani']),
 fixed('vault','Vault Day',1,6,['deity:Abadar']),
 fixed('ruby-prince','Ruby Prince’s Birthday',1,20,['region:Osirion']),
 fixed('merrymead','Merrymead',2,2,['region:Druma','deity:Cayden Cailean']),
 fixed('loyalty','Loyalty Day',2,19,['region:Cheliax','deity:Asmodeus']),
 fixed('bones','Day of Bones',3,5,['deity:Pharasma']),
 fixed('conquest','Conquest Day',3,26,['region:Nex']),
 fixed('currentseve','Currentseve',4,7,['deity:Gozreh']),
 fixed('taxfest','Taxfest',4,15,['deity:Abadar','deity:Brigh']),
 fixed('ascendance-night','Ascendance Night',5,2,['deity:Norgorber']),
 fixed('old-mage','Old-Mage Day',5,13,['region:Nantambu','region:Mwangi Expanse']),
 fixed('archer','Archer’s Day',7,3,['deity:Erastil']),
 fixed('founding-korvosa','Founding Festival',7,14,['region:Korvosa']),
 fixed('silenced-whispers','Day of Silenced Whispers',8,9,['region:Ustalav']),
 {...fixed('armasse','Armasse',8,16,['deity:Aroden','deity:Iomedae','deity:Milani','region:Corentyn'],'https://pathfinderwiki.com/wiki/Armasse'),durationDays:7,summary:'Martial training and communal celebration.'},
 {...fixed('jestercap','Jestercap',10,27,['culture:Gnomes','region:Andoran','region:Druma','region:Taldor'],'https://paizo.com/blog/celebrating-jestercap'),dateLabel:'27 Lamashan; some regions use the last Starday',summary:'A festival of practical jokes.'},
 fixed('allbirth','Allbirth',10,30,['deity:Lamashtu']),
 fixed('seven-veils','Seven Veils',11,7,['deity:Sivanah']),
 fixed('abjurant','Abjurant Day',11,8,['deity:Nethys']),
 fixed('evoking','Evoking Day',11,18,['deity:Nethys']),
 fixed('transmutatum','Transmutatum',11,28,['deity:Nethys']),
 fixed('pseudodragon','Pseudodragon Festival',12,7,['region:Korvosa']),
 fixed('cayden-ascension','Ascension Day',12,11,['deity:Cayden Cailean']),
 seasonal('firstbloom','Firstbloom',3,'Vernal equinox',['deity:Gozreh']),
 seasonal('sunwrought','Sunwrought Festival',6,'Summer solstice',['deity:Sarenrae','deity:Brigh']),
 {...seasonal('stardust-summer','Ritual of Stardust',6,'Summer solstice',['deity:Desna'],'https://pathfinderwiki.com/wiki/Ritual_of_Stardust'),summary:'An evening celebration beneath the stars.'},
 {...seasonal('swallowtail','Swallowtail Festival',9,'First day of autumn',['deity:Desna','deity:Chaldira Zuzaristan'],'https://pathfinderwiki.com/wiki/Swallowtail_Festival'),summary:'A gathering honouring Desna.'},
 seasonal('crystalhue','Crystalhue',12,'Winter solstice',['deity:Shelyn']),
 {...seasonal('stardust-winter','Ritual of Stardust',12,'Winter solstice',['deity:Desna'],'https://pathfinderwiki.com/wiki/Ritual_of_Stardust'),summary:'An evening celebration beneath the stars.'},
];
export const HOLIDAY_GROUPS=[...new Set(GOLARION_HOLIDAYS.flatMap(h=>h.tags))].sort();
export const CALENDAR_CATALOGUE_NOTE='Curated Golarion observances. Seasonal entries require a GM-selected date; no equinox or solstice is silently assumed. Sources may describe different historical periods or local practices.';
