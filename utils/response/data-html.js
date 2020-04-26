import { DateTime } from 'luxon';
import getSafeAssetUrl from '../safe-asset-url';
import getResponseUrl from '../response-url';
import createQueryText from '../query-text';
import jsonldFrame from '../jsonld-frame';
import toArray from '../to-array';
import { Article, WebPage, ItemList } from '../../tree/schema';
import getResourceLinkData from '../resource-link-data';
// import fetchResource from '../fetch-resource';

const supportedTypes = [
  'website',
  'feed',
  'article',
];

function createAttribute(doc) {
  return (querySelector, attribute) => {
    const element = doc.querySelector(querySelector);
    return element && element.hasAttribute(attribute) ? element.getAttribute(attribute) : null;
  };
}

function intersection(a, b) {
  return a.filter((x) => b.includes(x));
}

function getBestImages(data, ratio) {
  return toArray(data || []).filter((i) => typeof i !== 'string' || !!i.url).sort((a, b) => {
    if (!a.width || !b.width) {
      return 0;
    }

    if (!a.height || !b.height) {
      return 0;
    }

    const aRatio = a.width / a.height;
    const bRatio = b.width / b.height;

    const aDiff = aRatio > ratio ? aRatio - ratio : ratio - aRatio;
    const bDiff = bRatio > ratio ? bRatio - ratio : ratio - bRatio;

    return aDiff - bDiff;
  }).reduce((acc, img) => {
    // Remove any images that do not fit the ratio of the first image.
    if (acc.length === 0) {
      return [
        img,
      ];
    }

    if (!acc[0].width || !acc[0].height) {
      return [
        ...acc,
        img,
      ];
    }

    const firstRatio = acc[0].width / acc[0].height;
    const currRatio = img.width / img.height;

    if (firstRatio !== currRatio) {
      return acc;
    }

    return [
      ...acc,
      img,
    ];
  }, [])
    .sort((a, b) => {
      if (!a.width || !b.width) {
        return 0;
      }

      return a.width - b.width;
    });
}

// async function getManifest(url) {
//   const response = await fetchResource(url).toPromise();
//   return response.json();
// }

async function getResponseDataHTML(response, doc) {
  const url = getResponseUrl(response);
  const head = doc.querySelector('head');
  const attribute = createAttribute(head);
  const text = createQueryText(head);

  let type = 'ItemPage';
  let sitename;
  let title;
  let description;
  let banner;
  let icon;
  let manifest;
  let datePublished;
  let items = [];

  // @TODO Get the "canonical" url

  // const manifestHref = attribute('link[rel="manifest"]', 'href');
  // if (manifestHref) {
  //   manifest = new URL(manifestHref, url.toString());
  //   // @TODO Move this higher up so we aren't getting it on every result.
  //   const manifest = await getManifest(manifestURL.toString());
  //   sitename = manifest.name || sitename;
  //   const appIcons = toArray(manifest.icons)
  //     .filter((i) => !!i.sizes)
  //     .map((i) => ({
  //       ...i,
  //       sizes: i.sizes.split(' ').map((size) => (
  //         size.split('x').map((num) => parseInt(num, 10))
  //       )).filter(([width, height]) => width === height).sort(([a], [b]) => a - b),
  //     }))
  //     .sort((a, b) => {
  //       const [aSize] = a.sizes;
  //       const [bSize] = b.sizes;

  //       const [aWidth] = aSize;
  //       const [bWidth] = bSize;

  //       if (aWidth > bWidth) {
  //         return -1;
  //       }

  //       if (bWidth > aWidth) {
  //         return 1;
  //       }

  //       return 0;
  //     });

  //   icon = appIcons.length > 0 && appIcons[0].src ? appIcons[0].src : icon;
  // }

  if (!icon) {
    const icons = [...head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').values()].filter((element) => !!element.hasAttribute('href'))
      .sort((a, b) => {
      // Prefer larger.
        if (!a.hasAttribute('sizes') || !b.hasAttribute('sizes')) {
          return 0;
        }

        const aSize = parseInt(a.getAttribute('sizes').split('x')[0], 10);
        const bSize = parseInt(b.getAttribute('sizes').split('x')[0], 10);

        return bSize - aSize;
      }).map((link) => link.getAttribute('href'));

    icon = icons.length > 0 ? icons[0] : icon;
  }

  let jsonDocs = [];
  const jsonNodes = doc.querySelectorAll('script[type="application/ld+json"]');
  if (jsonNodes.length > 0) {
    if (url.hash && jsonNodes.length > 1) {
      const id = url.hash.substring(1);
      jsonDocs = [...jsonNodes.values()].filter((n) => n.id === id).map((n) => n.textContent);
    } else {
      jsonDocs = [...jsonNodes.values()].map((n) => n.textContent);
    }
  }

  if (jsonDocs) {
    try {
      const docs = jsonDocs.map((json) => JSON.parse(json));

      // @TODO Use the canonical?
      const jsonld = await jsonldFrame(docs, {
        mainEntityOfPage: url.toString(),
        mainEntity: {},
      });

      // @TODO Get the most "relevant"? or maybe concatenate everything?
      const data = jsonld['@graph'] ? jsonld['@graph'][0] : jsonld;

      let mainCreativeWork;

      if (intersection(toArray(data.type), Article).length) {
        type = 'ItemPage';
        mainCreativeWork = data;
      }

      if (intersection(toArray(data.type), WebPage).length) {
        // @TODO This seems like a lie...
        type = 'CollectionPage';
        mainCreativeWork = data;
        if (data.mainEntity) {
          items = toArray(data.mainEntity.itemListElement || []).map((item) => item.url);
        }
      }

      if (intersection(toArray(data.type), ItemList).length) {
        type = 'CollectionPage';
        items = toArray(data.itemListElement || []).map((item) => item.url);
        if (data.mainEntityOfPage) {
          mainCreativeWork = data.mainEntityOfPage;
        }
      }

      if (mainCreativeWork) {
        title = mainCreativeWork.name || mainCreativeWork.headline || title;
        description = mainCreativeWork.description || mainCreativeWork.headline || description;

        if (data.datePublished) {
          try {
            datePublished = DateTime.fromISO(data.datePublished, { zone: 'utc' }).toISO();
          } catch (e) {
            // Silence is Golden.
          }
        }

        if (mainCreativeWork.publisher) {
          const publishers = await jsonldFrame(docs, {
            id: toArray(mainCreativeWork.publisher).map((p) => p.id),
          });

          // What do we do if there is more than one?
          // Maybe use Intl.ListFormat and a pollyfill?
          const publisher = publishers['@graph'] ? publishers['@graph'][0] : publishers;

          sitename = publisher.name || sitename;
          description = publisher.description || description;
          // @TODO Should this be image if it's a Person and... logo if it's an org?
          const publisherImage = getBestImages([
            ...toArray(publisher.logo || []),
            ...toArray(publisher.brand && publisher.brand.logo ? publisher.brand.logo : []),
            ...toArray(publisher.image || []),
          ], 1);

          // @TODO Use response images... somehow.
          if (publisherImage.length > 0) {
            if (typeof publisherImage[0] === 'string') {
              [icon] = publisherImage;
            } else if (publisherImage[0].url) {
              // Only override an existing icon if the width & height are a 1:1 ratio.
              if (icon) {
                if (publisherImage[0].width / publisherImage[0].height === 1) {
                  icon = publisherImage[0].url;
                }
              } else {
                icon = publisherImage[0].url;
              }
            }
          }
        }

        const ratio = type === 'CollectionPage' ? 21 / 9 : 16 / 9;
        const image = getBestImages(mainCreativeWork.image, ratio);

        // @TODO Use response images... somehow.
        if (image.length > 0) {
          if (typeof image[0] === 'string') {
            [banner] = image;
          } else if (image[0].url) {
            banner = image[0].url;
          }
        }
      }
    } catch (e) {
      // Silence is Golden.
    }
  }

  if (!type) {
    // If it's the root of the site, always assume it's a collection.
    if (url.pathname === '/') {
      type = 'CollectionPage';
    } else {
      type = attribute('meta[property="og:type"], meta[name="og:type"]', 'content');
      // If the type returned is not supported, override it to an article for now.
      if (!supportedTypes.includes(type)) {
        type = 'ItemPage';
      }
    }
  }

  if (!title) {
    title = attribute('meta[property="og:title"], meta[name="og:title"]', 'content');
  }
  if (!title) {
    title = text('title');
  }

  if (!sitename) {
    sitename = attribute('meta[property="og:site_name"], meta[name="og:site_name"]', 'content');
  }
  if (!sitename) {
    sitename = attribute('meta[name="application-name"]', 'content');
  }
  if (!sitename) {
    sitename = text('title');
  }

  if (!description) {
    description = attribute('meta[property="og:description"], meta[name="og:description"]', 'content');
  }
  if (!description) {
    description = attribute('meta[name="description"]', 'content');
  }

  if (!banner) {
    banner = attribute('meta[property="og:image"], meta[name="og:image"]', 'content');
  }

  if (!datePublished) {
    const datetime = attribute('meta[property="article:published_time"], meta[name="article:published_time"]', 'content');
    if (datetime) {
      datePublished = DateTime.fromISO(datetime, { zone: 'utc' }).toISO();
    }
  }

  const feeds = [...head.querySelectorAll('link[rel="alternate"]').values()].map((link, index) => ({
    link,
    order: index,
  })).filter(({ link }) => {
    // If the feed is missing an href, it should not be considered.
    if (!link.hasAttribute('href')) {
      return false;
    }

    // If the link is missing a type, it's not a feed.
    if (!link.hasAttribute('type')) {
      return false;
    }

    // Only include types we currently support.
    if (!['application/json', 'application/xml', 'application/rss+xml', 'application/atom+xml', 'text/xml'].includes(link.getAttribute('type'))) {
      return false;
    }

    return true;
  })
    .sort(({ link: a }, { link: b }) => {
    // Prefer JSON.
      if (!a.hasAttribute('type') || !b.hasAttribute('type')) {
        return 0;
      }

      if (a.getAttribute('type') === b.getAttribute('type')) {
        return 0;
      }

      if (a.getAttribute('type') === 'application/json') {
        return -1;
      }

      if (b.getAttribute('type') === 'application/json') {
        return 1;
      }

      return 0;
    })
    .reduce((acc, item) => {
    // Dedupe the feeds by the title.
      if (acc.find((i) => i.link.getAttribute('title') === item.link.getAttribute('title'))) {
        return acc;
      }

      return [
        ...acc,
        item,
      ];
    }, [])
    .sort((a, b) => a.order - b.order)
    .map(({ link }) => (new URL(link.getAttribute('href'), url)).toString());

  const pageURL = new URL(getResourceLinkData(url.toString()).as, 'https://chickar.ee/');
  const siteURL = new URL(getResourceLinkData(url.origin).as, 'https://chickar.ee/');

  const author = {
    id: siteURL.toString(),
    type: 'Organization',
    url: siteURL.toString(),
    name: sitename,
    description,
    logo: icon ? getSafeAssetUrl(icon, url.toString()) : null,
    sameAs: url.origin,
  };

  const page = {
    '@context': 'http://schema.org/',
    type,
    url: pageURL.toString(),
    datePublished,
    name: title,
    publisher: {
      type: 'Organization',
      name: 'Chickaree',
      url: 'https://chickar.ee',
      // @TODO Add the default image and logo here!
    },
    author,
    description,
    primaryImageOfPage: banner ? { url: getSafeAssetUrl(banner, url.toString()) } : null,
    // significantLink: feeds,
    // mainEntity: {
    //   type: 'ItemList',
    //   itemListElement: items,
    // },
  };

  if (type === 'CollectionPage') {
    return {
      ...page,
      about: author,
      // @TODO Make this part of the items?
      significantLink: feeds,
      mainEntity: {
        type: 'ItemList',
        // @TODO The items should be URLs on Chickaree
        itemListElement: items,
      },
    };
  }

  return {
    ...page,
    mainEntity: {
      type: 'SocialMediaPosting',
      author,
      datePublished,
      sharedContent: {
        id: url.toString(),
        type: 'Article',
        url: url.toString(),
        name: title,
        description,
        image: banner ? { url: getSafeAssetUrl(banner, url.toString()) } : null,
      },
    },
  };

  return {
    type,
    url: url.toString(),
    datePublished,
    name: title,
    publisher: {
      type: 'Organization',
      name: sitename,
      logo: icon ? getSafeAssetUrl(icon, url.toString()) : null,
    },
    description,
    primaryImageOfPage: banner ? getSafeAssetUrl(banner, url.toString()) : null,
    significantLink: feeds,
    mainEntity: {
      type: 'ItemList',
      itemListElement: items,
    },
  };
}

export default getResponseDataHTML;
