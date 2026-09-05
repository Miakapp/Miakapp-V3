import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { createDemoHost } from './demo-host';

describe('App', () => {
  it('makes preview boundaries explicit and updates local semantic state', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Interactive product preview');
    expect(screen.getByRole('status')).toHaveTextContent('No cloud, relay, or home is connected.');
    expect(screen.getByText('3 lights on')).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: 'Kitchen' }));

    expect(screen.getByText('4 lights on')).toBeVisible();
  });

  it('navigates to the privacy explanation without a router or network call', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settingsButtons = screen.getAllByRole('button', { name: 'Settings' });
    await user.click(settingsButtons[0]!);

    expect(screen.getByRole('heading', { level: 1, name: 'Connection & privacy' })).toBeVisible();
    expect(screen.getByText('No cloud or home connection is active in this build.')).toBeVisible();
    expect(screen.getByText(/cannot inject HTML, CSS, URLs, or credentials/)).toBeVisible();
  });

  it('disposes the trusted host when the React shell unmounts', () => {
    const host = createDemoHost();
    const dispose = vi.spyOn(host, 'dispose');
    const view = render(<App createHost={() => host} />);

    view.unmount();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
