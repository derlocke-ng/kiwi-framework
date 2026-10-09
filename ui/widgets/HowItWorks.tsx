// "How it works": the topics an app is built from (shared/how.js) and lines
// of its own, as a card that opens on demand.
//
//   <HowItWorks items={[...HOW.feed, 'feed.how.circles']} />
import { HOW, HOW_TOPICS, howKey } from '../../shared/how.js';
import { Icon } from '../components';
import { useT } from '../hooks';

export { HOW, HOW_TOPICS, howKey };

export interface HowItWorksProps {
  /** topics ('media') and the app's own i18n keys ('feed.how.circles'), in order */
  items: readonly string[];
  id?: string;
  title?: string;
}

export function HowItWorks({ items, id = 'how', title }: HowItWorksProps) {
  const t = useT();
  return (
    <details className="card how" id={id}>
      <summary>
        <h2>
          <Icon name="shield" />
          <span>{title || t('how.title')}</span>
        </h2>
      </summary>
      <ul>
        {items.map((item) => (
          // the strings come from the hub's own catalogs, with links and emphasis in them
          <li key={item} data-how={item} dangerouslySetInnerHTML={{ __html: t(howKey(item)) }} />
        ))}
      </ul>
    </details>
  );
}
