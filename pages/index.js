import {
  useContext,
  useReducer,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { from, concat } from 'rxjs';
import {
  switchMap,
  flatMap,
  map,
  bufferTime,
  filter,
} from 'rxjs/operators';
import Link from 'next/link';
import { DateTime } from 'luxon';
import useReactor from '@cinematix/reactor';
import AppContext from '../context/app';
import Layout from '../components/layout';
import Item from '../components/card/item';
import createFetchResourceData, { CACHE_FIRST, REVALIDATE, NETWORK_FIRST } from '../utils/fetch/resource-data';

function createFeedStream() {
  const fetchResourceData = createFetchResourceData();

  return (feeds, cacheStrategy) => (
    from(feeds).pipe(
      flatMap((feed) => fetchResourceData(feed, cacheStrategy)),
      flatMap(({ orderedItems, ...context }) => (
        from(orderedItems || []).pipe(
          flatMap((item) => (
            fetchResourceData(
              item.url.href,
              cacheStrategy === REVALIDATE ? NETWORK_FIRST : cacheStrategy,
            ).pipe(
              filter(({ type }) => type !== 'OrderedCollection'),
              map((data) => ({ ...item, ...data, context })),
            )
          )),
        )
      )),
    )
  );
}

function feedReactor(value$) {
  const feedStream = createFeedStream();

  return value$.pipe(
    map(([feeds]) => feeds),
    filter((feeds) => feeds.length > 0),
    switchMap((feeds, index) => {
      if (index === 0) {
        return concat(
          feedStream(feeds, CACHE_FIRST),
          feedStream(feeds, REVALIDATE),
        );
      }


      return feedStream(feeds, REVALIDATE);
    }),
    // Group by tick.
    bufferTime(0),
    filter((a) => a.length > 0),
    map((items) => ({
      type: 'ITEMS_ADD',
      payload: [...items.reduce((acc, item) => {
        if (!item) {
          return acc;
        }

        acc.set(item.url.href, item);

        return acc;
      }, new Map()).values()],
    })),
  );
}

const initialState = {
  items: [],
};

function getPublishedDateTime(item) {
  const published = item.published || item.updated;

  return published ? DateTime.fromISO(published) : DateTime.fromMillis(0);
}

function reducer(state, action) {
  switch (action.type) {
    case 'ITEMS_ADD':
      return {
        ...state,
        items: [...[
          ...state.items,
          ...action.payload,
        ].reduce((acc, item) => {
          acc.set(item.url.href, item);

          return acc;
        }, new Map()).values()].sort((a, b) => {
          const aDateTime = getPublishedDateTime(a);
          const bDateTime = getPublishedDateTime(b);

          return bDateTime.diff(aDateTime);
        }),
      };
    case 'RESET':
      return initialState;
    default:
      throw new Error('Invalid Action');
  }
}

function Index() {
  const [app] = useContext(AppContext);
  const [state, dispatch] = useReducer(reducer, initialState);
  const followingRef = useRef(state.following);

  useReactor(feedReactor, dispatch, [app.following]);

  useEffect(() => {
    followingRef.current = app.following;
  }, [
    app.following,
  ]);

  useEffect(() => {
    // @TODO Add an event handler for handling when people come back to the page.
  }, []);

  const hasFeed = useMemo(() => {
    if (app.status === 'init') {
      return true;
    }

    if (app.following.length > 0) {
      return true;
    }

    return false;
  }, [
    app.status,
    app.following,
  ]);


  const items = useMemo(() => {
    // @TODO Keep "today" in state.
    const now = DateTime.local();

    // Only show items that are in the past
    // @TODO add some sort of setInterval to re-render when those items are past now.
    return state.items.filter((item) => {
      const published = getPublishedDateTime(item);

      return published < now;
    });
  }, [
    state.items,
  ]);

  if (!hasFeed) {
    return (
      <Layout>
        <div className="container min-vh-100">
          <div className="row pt-5 align-content-stretch align-items-center min-vh-100">
            <div className="mt-3 col-lg-8 offset-lg-2 col text-center">
              <h2>Welcome!</h2>
              <p>
                To get started, try <Link href="/search"><a>searching</a></Link> for feeds by name or by <Link href="/search"><a>providing</a></Link> a URL.
              </p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container pt-5">
        <div className="row">
          <div className="mt-3 col-lg-8 offset-lg-2 col">
            {items.map((item) => (
              <Item key={item.url.href} resource={item} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}


export default Index;
