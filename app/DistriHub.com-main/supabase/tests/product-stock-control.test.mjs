import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { checkoutCreditDatabase } from './fixtures/checkout_credit_database.mjs';

test('PDV sells a prepared product at zero stock and cancellation respects the original stock policy', async () => {
  const db = await checkoutCreditDatabase();
  try {
    await db.exec(`
      CREATE FUNCTION partner_rma_private.guard_return() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.product_id IS NULL THEN RAISE EXCEPTION 'Reintegração exige produto'; END IF;
        RETURN NEW;
      END $$;
    `);
    const [company, branch, madeToOrder, packaged, drinkSale, packagedSale] = Array.from({ length: 6 }, () => randomUUID());
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [company]);
    await db.query("INSERT INTO partner_profiles(id,account_name,business_name) VALUES($1,'Dono','Loja')", [company]);
    await db.query("INSERT INTO partner_branches(id,user_id,name) VALUES($1,$2,'Balcão')", [branch, company]);
    await db.query("INSERT INTO partner_products(id,user_id,branch_id,name,stock,is_service) VALUES($1,$3,$4,'Açaí Frozen 300 ml',0,false),($2,$3,$4,'Picolé',1,false)", [madeToOrder, packaged, company, branch]);
    await db.exec(await readFile(new URL('../migrations/20261124053715_product_stock_control.sql', import.meta.url), 'utf8'));
    const stock = async product => (await db.query('SELECT stock,control_stock,is_service FROM partner_products WHERE id=$1', [product])).rows[0];
    assert.deepEqual(await stock(madeToOrder), { stock: 0, control_stock: true, is_service: false });
    await db.query("SELECT set_config('test.auth_uid',$1,false)", [company]);
    await db.query("SELECT mutate_partner_cash_register('abrir',$1,NULL,NULL,NULL,0,NULL,'',NULL,NULL,$2)", [branch, randomUUID()]);
    const sale = (id, product) => db.query(
      "SELECT execute_partner_sale_mutation(NULL,NULL,$1,NULL,'Cliente',$2::jsonb,12,NULL,NULL,'dinheiro',$3,'concluida','pdv','varejo','balcao',NULL)",
      [id, JSON.stringify([{ product_id: product, name: 'Produto', quantity: 1, unit_price: 12 }]), branch],
    );
    await assert.rejects(sale(drinkSale, madeToOrder), /Estoque insuficiente/);
    await db.query('UPDATE partner_products SET control_stock=false WHERE id=$1', [madeToOrder]);
    await sale(drinkSale, madeToOrder);
    assert.deepEqual(await stock(madeToOrder), { stock: 0, control_stock: false, is_service: false });
    assert.equal((await db.query('SELECT * FROM stock_movements WHERE product_id=$1', [madeToOrder])).rows.length, 0);
    await sale(packagedSale, packaged);
    assert.equal((await stock(packaged)).stock, 0);
    await db.query('UPDATE partner_products SET control_stock=(id=$1) WHERE id IN ($1,$2)', [madeToOrder, packaged]);
    await db.query('SELECT cancel_partner_history_sale($1,$2)', [drinkSale, branch]);
    await db.query('SELECT cancel_partner_history_sale($1,$2)', [packagedSale, branch]);
    assert.equal((await stock(madeToOrder)).stock, 0);
    assert.equal((await stock(packaged)).stock, 1);
  } finally {
    await db.close();
  }
});
