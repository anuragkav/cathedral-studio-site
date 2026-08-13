// Cathedral Studio — Collection I product data.
// Pre-production plan only: nothing below has been manufactured, and no
// image is a photograph of this collection's actual garments (see
// disclosure in index.html footer) — "img" is a hand-picked stand-in
// editorial photo (Unsplash), not a photo of the named piece.

// Each "img" below is drawn from a pool of 11 (men) / 9 (women) distinct,
// hand-vetted photos. The pool is smaller than the 14-piece catalog, so a
// few images repeat — but repeats are placed >=9 positions apart (never
// in the same or an adjacent grid row) so no two nearby cards ever look
// like duplicates.
const PRODUCTS = {
  men: [
    { id: "men-01", n: "01", name: "Nave Overcoat",         cat: "Outerwear", img: "1520975916090-3105956dac38", fabric: "Doubleface wool",     price: 1450 },
    { id: "men-02", n: "02", name: "Cloister Trench",       cat: "Outerwear", img: "1591047139829-d91aecb6caea", fabric: "Cotton twill",        price: 980  },
    { id: "men-03", n: "03", name: "Sacristy Field Jacket", cat: "Outerwear", img: "1548126032-079a0fb0099d",    fabric: "Waxed cotton",        price: 780  },
    { id: "men-04", n: "04", name: "Buttress Chore Coat",   cat: "Outerwear", img: "1618886614638-80e3c103d31a", fabric: "Boiled canvas",       price: 560  },
    { id: "men-05", n: "05", name: "Ambo Blazer",           cat: "Tailoring", img: "1617137968427-85924c800a22", fabric: "Wool suiting",        price: 890  },
    { id: "men-06", n: "06", name: "Chancel Trouser",       cat: "Tailoring", img: "1594938298603-c8148c4dae35", fabric: "Wool gabardine",      price: 410  },
    { id: "men-07", n: "07", name: "Transept Denim",        cat: "Trouser",   img: "1544441893-675973e31985",    fabric: "14oz selvedge denim", price: 340  },
    { id: "men-08", n: "08", name: "Compline Cardigan",     cat: "Knitwear",  img: "1521572163474-6864f9cf17ab", fabric: "Cashmere",            price: 690  },
    { id: "men-09", n: "09", name: "Lauds Turtleneck",      cat: "Knitwear",  img: "1602810316693-3667c854239a", fabric: "Cashmere",            price: 520  },
    { id: "men-10", n: "10", name: "Rood Screen Sweater",   cat: "Knitwear",  img: "1621072156002-e2fccdc0b176", fabric: "Merino cable knit",   price: 420  },
    { id: "men-11", n: "11", name: "Vespers Knit Polo",     cat: "Knitwear",  img: "1479064555552-3ef4979f8908", fabric: "Mercerized cotton",   price: 290  },
    { id: "men-12", n: "12", name: "Matins Oxford Shirt",   cat: "Shirting",  img: "1520975916090-3105956dac38", fabric: "Cotton poplin",       price: 260  },
    { id: "men-13", n: "13", name: "Narthex Tee",           cat: "Jersey",    img: "1591047139829-d91aecb6caea", fabric: "Heavyweight cotton",  price: 135  },
    { id: "men-14", n: "14", name: "Reliquary Scarf",       cat: "Accessory", img: "1548126032-079a0fb0099d",    fabric: "Wool and silk",       price: 210  }
  ],
  women: [
    { id: "women-01", n: "01", name: "Sanctuary Coat",       cat: "Outerwear", img: "1483985988355-763728e1935b", fabric: "Doubleface wool",     price: 1380 },
    { id: "women-02", n: "02", name: "Apse Trench",          cat: "Outerwear", img: "1608063615781-e2ef8c73d114", fabric: "Cotton twill",        price: 920  },
    { id: "women-03", n: "03", name: "Basilica Blazer",      cat: "Tailoring", img: "1544022613-e87ca75a784a",    fabric: "Wool suiting",        price: 860  },
    { id: "women-04", n: "04", name: "Aisle Trouser",        cat: "Tailoring", img: "1594633312681-425c7b97ccd1", fabric: "Wool crepe",          price: 390  },
    { id: "women-05", n: "05", name: "Litany Wide-Leg",      cat: "Trouser",   img: "1591369822096-ffd140ec948f", fabric: "Wool crepe",          price: 410  },
    { id: "women-06", n: "06", name: "Chantry Skirt",        cat: "Skirt",     img: "1585487000160-6ebcfceb0d03", fabric: "Wool",                price: 380  },
    { id: "women-07", n: "07", name: "Requiem Slip Skirt",   cat: "Skirt",     img: "1554412933-514a83d2f3c8",    fabric: "Silk charmeuse",      price: 310  },
    { id: "women-08", n: "08", name: "Verona Slip Dress",    cat: "Dress",     img: "1550928431-ee0ec6db30d3",    fabric: "Silk charmeuse",      price: 650  },
    { id: "women-09", n: "09", name: "Gloria Knit Dress",    cat: "Dress",     img: "1516726817505-f5ed825624d8", fabric: "Merino",              price: 460  },
    { id: "women-10", n: "10", name: "Vestry Cardigan",      cat: "Knitwear",  img: "1483985988355-763728e1935b", fabric: "Cashmere",            price: 610  },
    { id: "women-11", n: "11", name: "Choir Turtleneck",     cat: "Knitwear",  img: "1608063615781-e2ef8c73d114", fabric: "Cashmere",            price: 480  },
    { id: "women-12", n: "12", name: "Rosary Blouse",        cat: "Shirting",  img: "1544022613-e87ca75a784a",    fabric: "Silk crepe de chine", price: 340  },
    { id: "women-13", n: "13", name: "Psalter Camisole",     cat: "Jersey",    img: "1594633312681-425c7b97ccd1", fabric: "Silk charmeuse",      price: 220  },
    { id: "women-14", n: "14", name: "Halo Scarf",           cat: "Accessory", img: "1591369822096-ffd140ec948f", fabric: "Cashmere and silk",   price: 195  }
  ]
};
